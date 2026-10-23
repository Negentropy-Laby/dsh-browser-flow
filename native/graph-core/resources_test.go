package graphcore

import (
	"context"
	"fmt"
	"reflect"
	"testing"
)

func resourceSample() Input {
	in := sample(0)
	r := &ResourceDescriptor{ID: fmt.Sprintf("resource-%064x", 1), Basis: "document_instance", SnapshotKind: "observation", GroupingReason: "host_identity"}
	events := []Event{
		{Type: "asset", ID: "page-a", Kind: "page", Source: "host", Resource: r, DocumentToken: "document-a"},
		{Type: "asset", ID: "page-b", Kind: "page", Source: "host", Resource: r, DocumentToken: "document-a"},
		{Type: "attempt", ID: "action-a", Action: "click"},
		{Type: "edge", ID: "context-edge", From: "action-a", To: "page-b", Relation: "observed_on"},
		{Type: "receipt", ID: "action-a", Outcome: "executed"},
		{Type: "asset", ID: "proof", Kind: "evidence", Source: "code_verified"},
		{Type: "edge", ID: "proof-context", From: "proof", To: "page-b", Relation: "observed_on"},
	}
	for _, e := range events {
		e.Seq = int64(len(in.Events) + 1)
		e.Hash = fmt.Sprint(e.Seq)
		e.Run = in.Scope
		in.Events = append(in.Events, e)
	}
	in.Version = int64(len(in.Events))
	in.TailHash = in.Events[len(in.Events)-1].Hash
	in.Criteria = []Criterion{{ID: "criterion", Label: "trusted", Status: "passed", Source: "code_verified"}}
	in.ProofRef = "proof"
	in.ProofSeq = 7
	return in
}
func TestResourceViewsTraceAndRebuild(t *testing.T) {
	in := resourceSample()
	p := build(t, in)
	if len(p.Resources) != 2 || !reflect.DeepEqual(p.Resources[0].Snapshots, []string{"page-a", "page-b"}) {
		t.Fatal(p.Resources)
	}
	assets, _ := p.Detail("graph:assets")
	explore, _ := p.Detail("graph:exploration")
	if !reflect.DeepEqual(assets.(map[string]any)["anchors"], explore.(map[string]any)["anchors"]) {
		t.Fatal("anchors diverged")
	}
	trace, err := p.Detail(p.Resources[0].ID)
	if err != nil {
		t.Fatal(err)
	}
	if !reflect.DeepEqual(trace.(map[string]any)["evidenceRefs"], []string{"proof"}) {
		t.Fatal(trace)
	}
	if !reflect.DeepEqual(trace.(map[string]any)["explorationRefs"], []string{"action-a", "criterion", fmt.Sprintf("receipt-%s-6", in.Scope.TaskID)}) {
		t.Fatal(trace)
	}
	rebuilt, _ := build(t, in).Detail(p.Resources[0].ID)
	if !reflect.DeepEqual(trace, rebuilt) {
		t.Fatal("rebuild changed trace")
	}
}
func TestResourceRefCannotMergeRunsKindsOrUnknownIdentity(t *testing.T) {
	for _, mode := range []string{"run", "kind", "unknown"} {
		in := resourceSample()
		if mode == "run" {
			in.Events[2].Run.RunID = "other"
		}
		if mode == "kind" {
			in.Events[2].Kind = "file"
		}
		if mode == "unknown" {
			copy := *in.Events[2].Resource
			copy.Basis = "unavailable"
			in.Events[2].Resource = &copy
		}
		if _, err := Build(context.Background(), in, "projection"); err == nil {
			t.Fatal("accepted", mode)
		}
	}
}
func TestHistoricalCrossRunAnchorRetainsOriginalEndpointRuns(t *testing.T) {
	in := resourceSample()
	in.Events[1].Run.RunID = "old"
	copy := *in.Events[1].Resource
	copy.ID = fmt.Sprintf("resource-%064x", 2)
	in.Events[1].Resource = &copy
	in.Events[4].To = "page-a"
	p := build(t, in)
	if p.Anchors[0].ToRun.RunID != "old" || p.Anchors[0].FromRun.RunID != in.Scope.RunID || p.Anchors[0].SourceSeq != 5 {
		t.Fatal(p.Anchors)
	}
}
