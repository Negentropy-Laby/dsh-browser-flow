// SPDX-License-Identifier: Apache-2.0
package graphcore

import (
	"bytes"
	"context"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"encoding/hex"
	"encoding/json"
	"errors"
	"io"
	"time"
)

// Request is the closed internal protocol v2 envelope. Input is hash-bound raw JSON.
type Request struct {
	ProtocolVersion int             `json:"protocolVersion"`
	ID              string          `json:"id"`
	Generation      string          `json:"generation"`
	Scope           Scope           `json:"scope"`
	Version         int64           `json:"version"`
	TailHash        string          `json:"tailHash"`
	InputHash       string          `json:"inputHash"`
	Op              string          `json:"op"`
	BudgetMS        int64           `json:"budgetMs"`
	Budget          int             `json:"budget"`
	Input           json.RawMessage `json:"input,omitempty"`
	Ref             string          `json:"ref,omitempty"`
	OffsetBytes     int             `json:"offsetBytes,omitempty"`
}

// Response echoes every request binding, including on typed failures.
type Response struct {
	ProtocolVersion int    `json:"protocolVersion"`
	ID              string `json:"id"`
	Generation      string `json:"generation"`
	Scope           Scope  `json:"scope"`
	Version         int64  `json:"version"`
	TailHash        string `json:"tailHash"`
	InputHash       string `json:"inputHash"`
	OK              bool   `json:"ok"`
	Code            string `json:"code,omitempty"`
	Value           any    `json:"value,omitempty"`
}

func decode(b []byte, value any) error {
	d := json.NewDecoder(bytes.NewReader(b))
	d.DisallowUnknownFields()
	if err := d.Decode(value); err != nil {
		return err
	}
	if d.Decode(new(any)) != io.EOF {
		return errors.New("extra_json")
	}
	return nil
}

// Serve owns one run and one disposable projection. It never opens files or sockets.
func Serve(reader io.Reader, writer io.Writer, maxFrame, maxDetail int) error {
	if maxFrame < 65536 || maxFrame > 32*1024*1024 {
		return errors.New("invalid_frame_limit")
	}
	if maxDetail < maxFrame || maxDetail > 256*1024*1024 {
		return errors.New("invalid_detail_limit")
	}
	var detailRef string
	var detailBytes []byte
	var bound *Scope
	generation := ""
	var current *Projection
	for {
		var prefix [4]byte
		if _, err := io.ReadFull(reader, prefix[:]); err != nil {
			if err == io.EOF {
				return nil
			}
			return errors.New("truncated_frame")
		}
		size := binary.BigEndian.Uint32(prefix[:])
		if size == 0 || uint64(size) > uint64(maxFrame) {
			return errors.New("frame_limit")
		}
		body := make([]byte, int(size))
		if _, err := io.ReadFull(reader, body); err != nil {
			return errors.New("truncated_frame")
		}
		var q Request
		if decode(body, &q) != nil {
			return errors.New("invalid_request")
		}
		r := Response{ProtocolVersion: 2, ID: q.ID, Generation: q.Generation, Scope: q.Scope, Version: q.Version, TailHash: q.TailHash, InputHash: q.InputHash}
		fail := func(code string) { r.OK = false; r.Code = code; r.Value = nil }
		switch {
		case q.ProtocolVersion != 2:
			fail("protocol_mismatch")
		case q.ID == "" || len(q.ID) > 100 || q.Generation == "" || len(q.Generation) > 100 || q.BudgetMS <= 0 || q.BudgetMS > 300000 || q.Scope.TaskID == "" || q.Scope.ProfileID == "" || q.Scope.OwnerSessionID == "" || q.Scope.RunID == "" || q.Scope.WorkflowRef == "" || q.Scope.ScopeRevision < 1:
			fail("invalid_request")
		case bound != nil && (*bound != q.Scope || generation != q.Generation):
			fail("binding_mismatch")
		default:
			switch q.Op {
			case "hello":
				if bound != nil {
					fail("already_bound")
				} else {
					s := q.Scope
					bound = &s
					generation = q.Generation
					r.OK = true
					r.Value = map[string]any{"kernelVersion": "3", "rulesVersion": "structural-v1"}
				}
			case "project":
				if bound == nil {
					fail("not_bound")
					break
				}
				p := current
				if p == nil || p.ID != q.InputHash {
					sum := sha256.Sum256(q.Input)
					var in Input
					if hex.EncodeToString(sum[:]) != q.InputHash || decode(q.Input, &in) != nil || in.Scope != q.Scope || in.Version != q.Version || in.TailHash != q.TailHash {
						fail("invalid_input")
						break
					}
					ctx, cancel := context.WithTimeout(context.Background(), time.Duration(q.BudgetMS)*time.Millisecond)
					var err error
					p, err = Build(ctx, in, q.InputHash)
					cancel()
					if err != nil {
						fail("projection_failed")
						break
					}
					current = p
					detailBytes = nil
					detailRef = ""
				} else if p.Input.Version != q.Version || p.Input.TailHash != q.TailHash {
					fail("invalid_input")
					break
				}

				r.OK = true
				r.Value = p.View(q.Budget)
			case "detail":
				if current == nil || current.ID != q.InputHash || current.Input.Scope != q.Scope || current.Input.Version != q.Version || current.Input.TailHash != q.TailHash {
					fail("stale_projection")
					break
				}
				if q.Ref != detailRef || detailBytes == nil {
					value, err := current.Detail(q.Ref)
					if err != nil {
						fail("stale_reference")
						break
					}
					detailBytes, err = json.Marshal(value)
					detailRef = q.Ref
					if err != nil {
						detailBytes = nil
						fail("response_encoding")
						break
					}
					if len(detailBytes) > maxDetail {
						detailBytes = nil
						fail("detail_capacity")
						break
					}
				}
				if q.OffsetBytes < 0 || q.OffsetBytes > len(detailBytes) {
					fail("invalid_offset")
					break
				}
				chunk := map[string]any{"ref": q.Ref, "offsetBytes": q.OffsetBytes, "totalBytes": len(detailBytes), "chunkBase64": "", "complete": false}
				r.OK = true
				r.Value = chunk
				envelope, _ := json.Marshal(r)
				count := (maxFrame - len(envelope)) / 4 * 3
				if count < 1 {
					fail("frame_limit")
					break
				}
				if remaining := len(detailBytes) - q.OffsetBytes; count > remaining {
					count = remaining
				}
				chunk["chunkBase64"] = base64.StdEncoding.EncodeToString(detailBytes[q.OffsetBytes : q.OffsetBytes+count])
				chunk["complete"] = q.OffsetBytes+count == len(detailBytes)

			default:
				fail("unsupported_operation")
			}
		}
		b, err := json.Marshal(r)
		if err != nil {
			return errors.New("response_encoding")
		}
		if len(b) > maxFrame {
			fail("frame_limit")
			b, _ = json.Marshal(r)
		}
		binary.BigEndian.PutUint32(prefix[:], uint32(len(b)))
		if _, err = writer.Write(prefix[:]); err != nil {
			return err
		}
		if _, err = writer.Write(b); err != nil {
			return err
		}
	}
}
