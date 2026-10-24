package graphcore

import (
	"context"
	"encoding/json"
	"fmt"
	"reflect"
	"testing"
)

func semanticSample() Input {
	in := sample(0)
	in.Exploration = true
	in.Scope.WorkflowRef = "exploration"
	in.Protected = []string{"origin"}
	add := func(e Event) {
		e.Run = in.Scope
		e.Seq = int64(len(in.Events) + 1)
		e.Hash = fmt.Sprintf("%064x", e.Seq)
		in.Events = append(in.Events, e)
	}
	in.Events = nil
	add(Event{Type: "created", Semantic: &SemanticChange{Nodes: []SemanticNode{{"goal", "goal", "user_declared", map[string]any{"state": "open", "mandatory": true}}, {"origin", "fact", "host", map[string]any{"state": "origin", "confidence": "instruction"}}}, Edges: []SemanticEdge{{"origin-goal", "origin", "goal", "spawns"}}}})
	for i := 0; i < 9; i++ {
		id := fmt.Sprint("direction-", i)
		fact := fmt.Sprint("fact-", i)
		parent := "origin"
		if i > 0 {
			parent = fmt.Sprint("fact-", i-1)
		}
		add(Event{Type: "exploration", Semantic: &SemanticChange{Nodes: []SemanticNode{{id, "intent", "agent", map[string]any{"state": "open", "priority": 5}}}, Edges: []SemanticEdge{{"parent-" + id, parent, id, "derived_from"}}}})
		add(Event{Type: "exploration", Semantic: &SemanticChange{Updates: []SemanticUpdate{{id, "running"}}, Round: true}})
		for j := 0; j < 2; j++ {
			attempt := fmt.Sprintf("attempt-%d-%d", i, j)
			add(Event{Type: "attempt", ID: attempt, IntentID: id, Action: "click"})
			add(Event{Type: "receipt", ID: attempt, Outcome: "executed"})
		}
		add(Event{Type: "exploration", Semantic: &SemanticChange{Nodes: []SemanticNode{{fact, "fact", "agent", map[string]any{"state": "confirmed", "confidence": "observed"}}}, Edges: []SemanticEdge{{"yield-" + id, id, fact, "yields"}}}})
		add(Event{Type: "exploration", Semantic: &SemanticChange{Updates: []SemanticUpdate{{id, "done"}}}})
	}
	in.Version = int64(len(in.Events))
	in.TailHash = in.Events[len(in.Events)-1].Hash
	return in
}
func TestSemanticRoundsAndReadOnlyInput(t *testing.T) {
	in := semanticSample()
	before, _ := json.Marshal(in)
	a := build(t, in)
	b := build(t, in)
	after, _ := json.Marshal(in)
	if string(before) != string(after) {
		t.Fatal("projection mutated the replay input")
	}
	if a.Round != 9 || !reflect.DeepEqual(a.Digests, b.Digests) {
		t.Fatal("rounds count actions or reads rather than planner rounds")
	}
	if a.index["attempt-0-0"].Kind != "attempt" || a.index["direction-0"].Kind != "intent" {
		t.Fatal("semantic intent conflated with attempt")
	}
}
func TestSemanticIncrementalMatchesReference(t *testing.T) {
	in := semanticSample()
	for n := 1; n <= len(in.Events); n++ {
		part := in
		part.Events = in.Events[:n]
		part.Version = int64(n)
		part.TailHash = part.Events[n-1].Hash
		a, err := Build(context.Background(), part, "candidate")
		if err != nil {
			t.Fatal(err)
		}
		b, err := buildReplay(context.Background(), part, "candidate", referenceTransition)
		if err != nil {
			t.Fatal(err)
		}
		if !reflect.DeepEqual(a.Digests, b.Digests) || !reflect.DeepEqual(a.View(50000), b.View(50000)) {
			t.Fatalf("semantic transition %d diverged", n)
		}
	}
}
func TestSemanticRejectsForeignRunAndUnapprovedData(t *testing.T) {
	in := semanticSample()
	last := in.Events[len(in.Events)-1]
	last.Seq++
	last.Hash = "end"
	last.Run.RunID = "foreign"
	last.Semantic = &SemanticChange{Updates: []SemanticUpdate{{"direction-0", "running"}}}
	in.Events = append(in.Events, last)
	in.Version++
	in.TailHash = "end"
	if _, err := Build(context.Background(), in, "candidate"); err == nil {
		t.Fatal("foreign run updated a current semantic node")
	}
	in = semanticSample()
	in.Events[0].Semantic.Nodes[0].Data["physicalPath"] = "forbidden"
	if _, err := Build(context.Background(), in, "candidate"); err == nil {
		t.Fatal("unknown semantic payload accepted")
	}
}

func TestSemanticClosedStatesAndEventKinds(t *testing.T) {
	for _, mode := range []string{"wrong-event", "missing-update", "reopen", "wrong-initial", "missing-to"} {
		t.Run(mode, func(t *testing.T) {
			in := semanticSample()
			e := Event{Seq: in.Version + 1, Hash: "invalid", Run: in.Scope, Type: "exploration", Semantic: &SemanticChange{}}
			switch mode {
			case "wrong-event":
				e.Type = "status"
				e.Semantic.Updates = []SemanticUpdate{{"missing", "running"}}
			case "missing-update":
				e.Semantic.Updates = []SemanticUpdate{{"missing", "running"}}
			case "reopen":
				e.Semantic.Updates = []SemanticUpdate{{"direction-0", "open"}}
			case "wrong-initial":
				e.Semantic.Nodes = []SemanticNode{{"bad", "hint", "agent", map[string]any{"state": "running"}}}
			case "missing-to":
				e.Semantic.Edges = []SemanticEdge{{"bad", "origin", "missing", "spawns"}}
			}
			in.Events = append(in.Events, e)
			in.Version++
			in.TailHash = e.Hash
			if _, err := Build(context.Background(), in, "candidate"); err == nil {
				t.Fatal("invalid semantics accepted")
			}
		})
	}
}
