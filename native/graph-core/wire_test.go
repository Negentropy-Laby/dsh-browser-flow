package graphcore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"io"
	"testing"
)

func encodeFrame(value any) []byte {
	b, _ := json.Marshal(value)
	p := make([]byte, 4)
	binary.BigEndian.PutUint32(p, uint32(len(b)))
	return append(p, b...)
}
func TestCompleteChunkedDetail(t *testing.T) {
	in := sample(100)
	raw, _ := json.Marshal(in)
	sum := sha256.Sum256(raw)
	reader, input := io.Pipe()
	output, writer := io.Pipe()
	exited := make(chan error, 1)
	go func() { err := Serve(reader, writer, 65536, 32*1024*1024); writer.Close(); exited <- err }()
	defer func() {
		input.Close()
		output.Close()
		if err := <-exited; err != nil {
			t.Error(err)
		}
	}()
	q := Request{ProtocolVersion: 2, ID: "1", Generation: "generation", Scope: in.Scope, Version: in.Version, TailHash: in.TailHash, InputHash: hex.EncodeToString(sum[:]), BudgetMS: 5000, Budget: 6000}
	call := func() Response {
		t.Helper()
		if _, err := input.Write(encodeFrame(q)); err != nil {
			t.Fatal(err)
		}
		var prefix [4]byte
		if _, err := io.ReadFull(output, prefix[:]); err != nil {
			t.Fatal(err)
		}
		size := binary.BigEndian.Uint32(prefix[:])
		if size > 65536 {
			t.Fatal("oversized response")
		}
		body := make([]byte, size)
		io.ReadFull(output, body)
		var response Response
		if err := json.Unmarshal(body, &response); err != nil {
			t.Fatal(err)
		}
		return response
	}
	q.Op = "hello"
	if r := call(); !r.OK {
		t.Fatal(r)
	}
	q.Op = "project"
	q.Input = raw
	if r := call(); !r.OK {
		t.Fatal(r)
	}
	q.Op = "detail"
	q.Input = nil
	q.Ref = "graph"
	var assembled []byte
	chunks := 0
	for {
		r := call()
		if !r.OK {
			t.Fatal(r)
		}
		part := r.Value.(map[string]any)
		if int(part["offsetBytes"].(float64)) != len(assembled) {
			t.Fatal("offset mismatch")
		}
		chunk, err := base64.StdEncoding.DecodeString(part["chunkBase64"].(string))
		if err != nil {
			t.Fatal(err)
		}
		assembled = append(assembled, chunk...)
		chunks++
		if part["complete"] == true {
			if len(assembled) != int(part["totalBytes"].(float64)) {
				t.Fatal("incomplete detail")
			}
			break
		}
		q.OffsetBytes = len(assembled)
	}
	wireProjection, err := Build(context.Background(), in, q.InputHash)
	if err != nil {
		t.Fatal(err)
	}
	detail, _ := wireProjection.Detail("graph")
	want, _ := json.Marshal(detail)
	if chunks < 2 || !bytes.Equal(assembled, want) {
		t.Fatalf("lost complete detail: %d chunks", chunks)
	}
}
func TestWireBindingHashAndTruncation(t *testing.T) {
	in := sample(2)
	raw, _ := json.Marshal(in)
	h := sha256.Sum256(raw)
	q := Request{ProtocolVersion: 2, ID: "1", Generation: "generation", Scope: in.Scope, Version: in.Version, TailHash: in.TailHash, InputHash: hex.EncodeToString(h[:]), Op: "hello", BudgetMS: 5000, Budget: 8000}
	hello := encodeFrame(q)
	q.ID = "2"
	q.Op = "project"
	q.Input = raw
	input := append(hello, encodeFrame(q)...)
	q.ID = "view-other-budget"
	q.Budget = 6000
	q.Input = nil
	input = append(input, encodeFrame(q)...)
	q.ID = "3"
	q.Op = "detail"
	q.Input = nil
	q.Ref = "graph"
	input = append(input, encodeFrame(q)...)
	var out bytes.Buffer
	if err := Serve(bytes.NewReader(input), &out, 8*1024*1024, 32*1024*1024); err != nil {
		t.Fatal(err)
	}
	for i := 0; i < 4; i++ {
		var p [4]byte
		out.Read(p[:])
		b := make([]byte, binary.BigEndian.Uint32(p[:]))
		out.Read(b)
		var r Response
		json.Unmarshal(b, &r)
		if !r.OK || r.InputHash != q.InputHash {
			t.Fatalf("bad response: %s", b)
		}
	}
	for _, bad := range [][]byte{{0, 0}, {255, 255, 255, 255}, {0, 0, 0, 10, 1}} {
		if Serve(bytes.NewReader(bad), new(bytes.Buffer), 65536, 32*1024*1024) == nil {
			t.Fatal("accepted malformed frame")
		}
	}
	q.Op = "project"
	q.Input = raw
	q.InputHash = "wrong"
	var rejected bytes.Buffer
	if err := Serve(bytes.NewReader(append(hello, encodeFrame(q)...)), &rejected, 65536, 32*1024*1024); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(rejected.Bytes(), []byte("invalid_input")) {
		t.Fatal("accepted wrong digest")
	}
	q.Op = "detail"
	q.Scope.OwnerSessionID = "another"
	var foreign bytes.Buffer
	Serve(bytes.NewReader(append(hello, encodeFrame(q)...)), &foreign, 65536, 32*1024*1024)
	if !bytes.Contains(foreign.Bytes(), []byte("binding_mismatch")) {
		t.Fatal("accepted foreign owner")
	}
}
