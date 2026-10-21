package graphcore

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func sample(n int) Input {
	s := Scope{"profile-test", "task-test", "session-test", 1, "run-test", "generic"}
	in := Input{Scope: s, Goal: "Synthetic goal", Constraints: []string{}, Criteria: []Criterion{}, Protected: []string{}, ColdRounds: 6, MinGroup: 2}
	add := func(e Event) {
		e.Seq = int64(len(in.Events) + 1)
		e.Hash = fmt.Sprintf("%064x", e.Seq)
		e.Run = s
		in.Events = append(in.Events, e)
	}
	add(Event{Type: "created", Goal: in.Goal})
	for i := 0; i < n; i++ {
		id := fmt.Sprintf("intent-%d", i)
		add(Event{Type: "attempt", ID: id, Action: "click"})
		add(Event{Type: "receipt", ID: id, Outcome: "executed"})
	}
	in.Version = int64(len(in.Events))
	in.TailHash = in.Events[len(in.Events)-1].Hash
	return in
}
func build(t *testing.T, in Input) *Projection {
	t.Helper()
	p, err := Build(context.Background(), in, hashJSON(in))
	if err != nil {
		t.Fatal(err)
	}
	return p
}
func TestReplayReadsDoNotAdvanceRounds(t *testing.T) {
	in := sample(7)
	a, b := build(t, in), build(t, in)
	if a.Round != 7 || !reflect.DeepEqual(a.Digests, b.Digests) || len(a.Digests) == 0 {
		t.Fatalf("unstable replay: %v %v", a.Digests, b.Digests)
	}
	a.View(1800)
	a.View(8000)
	if a.Round != 7 {
		t.Fatal("read advanced round")
	}
}
func TestReplayExactColdBoundary(t *testing.T) {
	if len(build(t, sample(6)).Digests) != 0 {
		t.Fatal("premature digest")
	}
	if len(build(t, sample(7)).Digests) == 0 {
		t.Fatal("missing threshold digest")
	}
}
func TestReplayUnknownAndProofStayVisible(t *testing.T) {
	in := sample(9)
	in.Events[len(in.Events)-1].Outcome = "unknown_outcome"
	in.Protected = []string{"intent-0"}
	p := build(t, in)
	if p.covered["intent-8"] || p.covered["intent-0"] {
		t.Fatal("folded protected or unknown attempt")
	}
}
func TestReplayPartitionsDifferentRuns(t *testing.T) {
	in := sample(10)
	for i := 1; i < 7; i++ {
		in.Events[i].Run.RunID = "historical-run"
	}
	p := build(t, in)
	for _, d := range p.Digests {
		run := ""
		for _, id := range d.Members {
			n := p.index[id]
			if run != "" && run != n.run.RunID {
				t.Fatal("cross-run block")
			}
			run = n.run.RunID
		}
	}
}
func TestReplayAssetIdentityAndPrivateData(t *testing.T) {
	in := sample(0)
	for _, id := range []string{"asset-a", "asset-b"} {
		in.Events = append(in.Events, Event{Seq: int64(len(in.Events) + 1), Hash: id, Type: "asset", Run: in.Scope, ID: id, Kind: "file", Source: "host"})
	}
	in.Version = int64(len(in.Events))
	in.TailHash = "asset-b"
	p := build(t, in)
	if p.index["asset-a"] == nil || p.index["asset-b"] == nil {
		t.Fatal("merged assets")
	}
	if _, err := p.Detail("asset-foreign"); err == nil {
		t.Fatal("foreign detail")
	}
}
func TestReplaySignatureInvalidationAndStaleDetail(t *testing.T) {
	in := sample(9)
	a := build(t, in)
	old := a.Digests[0].ID
	in.Goal = "Changed anchor"
	b := build(t, in)
	if _, err := b.Detail(old); err == nil {
		t.Fatal("accepted old digest")
	}
	if reflect.DeepEqual(a.Digests, b.Digests) {
		t.Fatal("anchor change did not invalidate")
	}
}
func TestReplayCoversKeepOriginalsAndPublicDirection(t *testing.T) {
	p := build(t, sample(9))
	if len(p.Digests) == 0 {
		t.Fatal("no digest")
	}
	id := p.Digests[0].Members[0]
	if _, err := p.Detail(id); err != nil {
		t.Fatal(err)
	}
	for _, e := range p.Edges {
		if e.Relation == "attempts" && p.index[e.From].Kind != "intent" {
			t.Fatal("mutated public direction")
		}
	}
	value, err := p.Detail("graph")
	if err != nil {
		t.Fatal(err)
	}
	b, _ := json.Marshal(value)
	if len(b) == 0 {
		t.Fatal("empty graph")
	}
}
func TestReplayRejectsUnsupportedAndForeignEvents(t *testing.T) {
	for _, mode := range []string{"unknown", "owner", "sequence", "tail"} {
		in := sample(1)
		switch mode {
		case "unknown":
			in.Events[1].Type = "future_write"
		case "owner":
			in.Events[1].Run.OwnerSessionID = "foreign"
		case "sequence":
			in.Events[1].Seq = 99
		case "tail":
			in.TailHash = "wrong"
		}
		if _, err := Build(context.Background(), in, "test"); err == nil {
			t.Fatal(mode)
		}
	}
}
func TestReplayCanceled(t *testing.T) {
	ctx, cancel := context.WithCancel(context.Background())
	cancel()
	if _, err := Build(ctx, sample(2), "test"); err == nil {
		t.Fatal("ignored cancellation")
	}
}
func TestHotCyclesAndDeepChains(t *testing.T) {
	nodes := make([]cgNode, 5000)
	edges := []cgEdge{}
	for i := range nodes {
		nodes[i] = intent(int64(i+1), "done")
		if i > 0 {
			edges = append(edges, derived(int64(i), int64(i+1)))
		}
	}
	nodes[len(nodes)-1].State = "running"
	edges = append(edges, derived(5000, 1))
	if len(newColdGraph(nodes, edges).hotSet()) != len(nodes) {
		t.Fatal("lost deep cyclic ancestry")
	}
}
func TestViewBoundedStructure(t *testing.T) {
	p := build(t, sample(20))
	view := p.View(1)
	if view["active_context"].(map[string]any)["truncated"] != true {
		t.Fatal("missing truncation")
	}
	if _, ok := view["knowledge_graph"].(map[string]any)["details"]; !ok {
		t.Fatal("lost detail reference")
	}
}
