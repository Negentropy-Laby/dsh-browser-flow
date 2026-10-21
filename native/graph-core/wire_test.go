package graphcore

import (
	"bytes"
	"crypto/sha256"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"testing"
)

func encodeFrame(value any) []byte {
	b, _ := json.Marshal(value)
	p := make([]byte, 4)
	binary.BigEndian.PutUint32(p, uint32(len(b)))
	return append(p, b...)
}
func TestWireBindingHashAndTruncation(t *testing.T) {
	in := sample(2)
	raw, _ := json.Marshal(in)
	h := sha256.Sum256(raw)
	q := Request{ProtocolVersion: 1, ID: "1", Generation: "generation", Scope: in.Scope, Version: in.Version, TailHash: in.TailHash, InputHash: hex.EncodeToString(h[:]), Op: "hello", BudgetMS: 5000, Budget: 8000}
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
	if err := Serve(bytes.NewReader(input), &out, 8*1024*1024); err != nil {
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
		if Serve(bytes.NewReader(bad), new(bytes.Buffer), 65536) == nil {
			t.Fatal("accepted malformed frame")
		}
	}
	q.Op = "project"
	q.Input = raw
	q.InputHash = "wrong"
	var rejected bytes.Buffer
	if err := Serve(bytes.NewReader(append(hello, encodeFrame(q)...)), &rejected, 65536); err != nil {
		t.Fatal(err)
	}
	if !bytes.Contains(rejected.Bytes(), []byte("invalid_input")) {
		t.Fatal("accepted wrong digest")
	}
	q.Op = "detail"
	q.Scope.OwnerSessionID = "another"
	var foreign bytes.Buffer
	Serve(bytes.NewReader(append(hello, encodeFrame(q)...)), &foreign, 65536)
	if !bytes.Contains(foreign.Bytes(), []byte("binding_mismatch")) {
		t.Fatal("accepted foreign owner")
	}
}
