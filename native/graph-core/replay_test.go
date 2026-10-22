package graphcore

import (
	"context"
	"fmt"
	"reflect"
	"testing"
)

// referenceTransition deliberately retains the full replay in tests only.
func referenceTransition(p *Projection, stamps map[int64]*int64) {
	g := p.causal()
	cold := g.structuralCold(g.hotSet())
	for _, ref := range p.Input.Protected {
		if n := p.index[ref]; n != nil {
			delete(cold, n.key)
		}
	}
	for _, op := range computeStampOps(cold, stamps, p.Round) {
		if op.Set {
			v := op.Round
			stamps[op.ID] = &v
		} else {
			delete(stamps, op.ID)
		}
	}
}
func TestIncrementalMatchesReference(t *testing.T) {
	in := sample(12)
	extra := []Event{{Type: "attempt", ID: "live", Action: "type"}, {Type: "edge", ID: "cycle-a", From: "intent-0", To: "live", Relation: "yields"}, {Type: "edge", ID: "cycle-b", From: "live", To: "intent-0", Relation: "yields"}, {Type: "edge", ID: "child", From: "live", To: "intent-1", Relation: "yields"}, {Type: "receipt", ID: "live", Outcome: "unknown_outcome"}, {Type: "attempt", ID: "next", Action: "observe"}, {Type: "edge", ID: "deep", From: "live", To: "next", Relation: "yields"}, {Type: "receipt", ID: "next", Outcome: "executed"}}
	for _, e := range extra {
		e.Run = in.Scope
		e.Seq = int64(len(in.Events) + 1)
		e.Hash = fmt.Sprint(e.Seq)
		in.Events = append(in.Events, e)
	}
	for _, protected := range [][]string{nil, {"intent-0"}} {
		for n := 1; n <= len(in.Events); n++ {
			part := in
			part.Events = in.Events[:n]
			part.Version = int64(n)
			part.TailHash = part.Events[n-1].Hash
			part.Protected = protected
			a, err := Build(context.Background(), part, "identity")
			if err != nil {
				t.Fatal(err)
			}
			b, err := buildReplay(context.Background(), part, "identity", referenceTransition)
			if err != nil {
				t.Fatal(err)
			}
			if !reflect.DeepEqual(a.Digests, b.Digests) || !reflect.DeepEqual(a.View(50000), b.View(50000)) {
				t.Fatalf("transition %d diverged", n)
			}
		}
	}
}
func TestSequentialReplayVisitBound(t *testing.T) {
	p := build(t, sample(8000))
	if p.replayVisits > len(p.Input.Events)*20 {
		t.Fatalf("repeated history scans: %d visits for %d events", p.replayVisits, len(p.Input.Events))
	}
}
func BenchmarkSequentialReplay(b *testing.B) {
	for _, n := range []int{500, 1000, 2000, 4000, 8000} {
		b.Run(fmt.Sprint(2*n+1), func(b *testing.B) {
			in := sample(n)
			b.ResetTimer()
			for i := 0; i < b.N; i++ {
				if _, err := Build(context.Background(), in, "benchmark"); err != nil {
					b.Fatal(err)
				}
			}
		})
	}
}
