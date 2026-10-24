// SPDX-License-Identifier: Apache-2.0
package graphcore

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"encoding/json"
	"errors"
	"fmt"
	"sort"
)

// Scope identifies one task run; no worker may accept another task owner.
type Scope struct {
	ProfileID      string `json:"profileId"`
	TaskID         string `json:"taskId"`
	OwnerSessionID string `json:"ownerSessionId"`
	ScopeRevision  int64  `json:"scopeRevision"`
	RunID          string `json:"runId"`
	WorkflowRef    string `json:"workflowRef"`
}

// Criterion contains Host-verified display metadata, never a kernel judgment.
type Criterion struct {
	ID          string `json:"id"`
	Label       string `json:"label"`
	Status      string `json:"status"`
	Source      string `json:"source"`
	ValidatorID string `json:"validatorId,omitempty"`
	Version     int    `json:"version,omitempty"`
}

// Event excludes original assets, files, paths and business response bodies.
type Event struct {
	IntentID      string              `json:"intentId,omitempty"`
	Semantic      *SemanticChange     `json:"semantic,omitempty"`
	Seq           int64               `json:"seq"`
	Hash          string              `json:"hash"`
	Type          string              `json:"type"`
	Run           Scope               `json:"run"`
	ID            string              `json:"id,omitempty"`
	Kind          string              `json:"kind,omitempty"`
	Source        string              `json:"source,omitempty"`
	Action        string              `json:"action,omitempty"`
	Outcome       string              `json:"outcome,omitempty"`
	From          string              `json:"from,omitempty"`
	To            string              `json:"to,omitempty"`
	Relation      string              `json:"relation,omitempty"`
	Goal          string              `json:"goal,omitempty"`
	DocumentToken string              `json:"documentToken,omitempty"`
	Resource      *ResourceDescriptor `json:"resource,omitempty"`
}

// Input is a complete sanitized replay snapshot plus current proof references.
type Input struct {
	Exploration       bool        `json:"exploration,omitempty"`
	LiveDocumentToken string      `json:"liveDocumentToken"`
	Scope             Scope       `json:"scope"`
	Version           int64       `json:"version"`
	TailHash          string      `json:"tailHash"`
	Goal              string      `json:"goal"`
	Constraints       []string    `json:"constraints"`
	Criteria          []Criterion `json:"criteria"`
	Events            []Event     `json:"events"`
	Protected         []string    `json:"protected"`
	ProofRef          string      `json:"proofRef"`
	ProofSeq          int64       `json:"proofSeq"`
	ColdRounds        int         `json:"coldRounds"`
	MinGroup          int         `json:"minGroup"`
}

// Node preserves opaque public identifiers; integer IDs exist only inside algorithms.
type Node struct {
	ID        string         `json:"id"`
	TaskID    string         `json:"taskId"`
	Kind      string         `json:"kind"`
	Source    string         `json:"source"`
	SourceSeq int64          `json:"sourceSeq"`
	Data      map[string]any `json:"data"`
	run       Scope
	key       int64
}

// Edge retains public relation direction; compression has a separate causal view.
type Edge struct {
	ID        string `json:"id"`
	TaskID    string `json:"taskId"`
	From      string `json:"from"`
	To        string `json:"to"`
	Relation  string `json:"relation"`
	SourceSeq int64  `json:"sourceSeq"`
}

// Attempt is an observation of a journaled action, not executable work.
type Attempt struct {
	ID              string `json:"id"`
	Action          string `json:"action"`
	Status          string `json:"status"`
	SourceSeq       int64  `json:"sourceSeq"`
	Source          string `json:"source"`
	BusinessSuccess bool   `json:"businessSuccess"`
}

// Digest is a structural summary of immutable original members and anchors.
type Digest struct {
	ID         string         `json:"id"`
	Members    []string       `json:"members"`
	Anchors    []string       `json:"anchors"`
	Outcomes   map[string]int `json:"outcomes"`
	SourceSeqs []int64        `json:"sourceSeqs"`
	Signature  string         `json:"signature"`
}

// Projection is disposable and reconstructable from Input; it owns no task facts.
type Projection struct {
	Input        Input
	ID           string
	Nodes        []*Node
	Edges        []Edge
	Attempts     []*Attempt
	Digests      []Digest
	replayVisits int
	Round        int64
	index        map[string]*Node
	covered      map[string]bool
	Resources    []Resource
	Anchors      []Anchor
}

func pageWrite(action string) bool {
	switch action {
	case "click", "type", "select", "check", "set_file":
		return true
	}
	return false
}
func hashJSON(value any) string {
	b, _ := json.Marshal(value)
	h := sha256.Sum256(b)
	return hex.EncodeToString(h[:])
}
func (p *Projection) add(id, kind, source string, seq int64, run Scope, data map[string]any) *Node {
	if node := p.index[id]; node != nil {
		node.Data = data
		node.SourceSeq = seq
		return node
	}
	n := &Node{ID: id, TaskID: p.Input.Scope.TaskID, Kind: kind, Source: source, SourceSeq: seq, Data: data, run: run, key: int64(len(p.Nodes) + 1)}
	p.Nodes = append(p.Nodes, n)
	p.index[id] = n
	return n
}
func (p *Projection) edge(id, from, to, relation string, seq int64) {
	if p.index[from] != nil && p.index[to] != nil {
		p.Edges = append(p.Edges, Edge{id, p.Input.Scope.TaskID, from, to, relation, seq})
	}
}
func goalID(s Scope) string { return fmt.Sprintf("goal-%s-r%d", s.TaskID, s.ScopeRevision) }

// Build replays the journal without incrementing rounds for reads or restarts.
func Build(ctx context.Context, in Input, id string) (*Projection, error) {
	return buildReplay(ctx, in, id, nil)
}

func buildReplay(ctx context.Context, in Input, id string, oracle func(*Projection, map[int64]*int64)) (*Projection, error) {
	if in.Version != int64(len(in.Events)) || in.ColdRounds < 1 || in.MinGroup < 2 || in.Scope.TaskID == "" {
		return nil, errors.New("invalid_input")
	}
	p := &Projection{Input: in, ID: id, index: map[string]*Node{}, covered: map[string]bool{}, Edges: []Edge{}, Nodes: []*Node{}, Attempts: []*Attempt{}, Digests: []Digest{}}
	attempts := map[string]*Attempt{}
	stamps := map[int64]*int64{}
	replay := newReplay()
	protected := map[string]bool{}
	for _, ref := range in.Protected {
		protected[ref] = true
	}
	for i, event := range in.Events {
		if err := ctx.Err(); err != nil {
			return nil, err
		}
		if event.Seq != int64(i+1) || event.Run.TaskID != in.Scope.TaskID || event.Run.ProfileID != in.Scope.ProfileID || event.Run.OwnerSessionID != in.Scope.OwnerSessionID {
			return nil, errors.New("invalid_history")
		}
		if event.Semantic != nil && (!in.Exploration || event.Type != "created" && event.Type != "revise" && event.Type != "exploration") {
			return nil, errors.New("invalid_semantic_event_type")
		}
		switch event.Type {
		case "created", "revise":
			if event.Semantic != nil {
				if event.Type == "revise" {
					for _, n := range p.Nodes {
						if n.Kind == "intent" && n.run != event.Run {
							n.Data["state"] = "stopped"
						}
					}
				}
				if err := p.applySemantic(event); err != nil {
					return nil, err
				}
			} else {
				p.add(goalID(event.Run), "goal", "user_declared", event.Seq, event.Run, map[string]any{"goal": event.Goal})
			}
		case "asset":
			switch event.Kind {
			case "page", "file", "unit_check", "import_result", "evidence":
			default:
				return nil, errors.New("invalid_asset")
			}
			data := map[string]any{}
			if event.Kind == "page" {
				data["documentToken"] = event.DocumentToken
			}
			if event.Resource != nil {
				data["resourceRef"] = event.Resource.ID
				data["snapshotKind"] = event.Resource.SnapshotKind
			}
			p.add(event.ID, event.Kind, event.Source, event.Seq, event.Run, data)
		case "edge":
			p.edge(event.ID, event.From, event.To, event.Relation, event.Seq)
		case "attempt":
			if attempts[event.ID] != nil {
				return nil, errors.New("duplicate_attempt")
			}
			a := &Attempt{event.ID, event.Action, "pending", event.Seq, "model_intent", false}
			attempts[event.ID] = a
			p.Attempts = append(p.Attempts, a)
			kind := "intent"
			target := goalID(event.Run)
			if in.Exploration {
				kind = "attempt"
				if event.IntentID != "" {
					target = event.IntentID
				}
			}
			p.add(event.ID, kind, "model_intent", event.Seq, event.Run, map[string]any{"action": event.Action, "status": "pending", "businessSuccess": false})
			p.edge(fmt.Sprintf("intent-edge-%d", event.Seq), event.ID, target, "attempts", event.Seq)
		case "receipt":
			a := attempts[event.ID]
			if a == nil || a.Status != "pending" {
				return nil, errors.New("orphan_receipt")
			}
			a.Status = event.Outcome
			p.index[a.ID].Data["status"] = event.Outcome
			rid := fmt.Sprintf("receipt-%s-%d", in.Scope.TaskID, event.Seq)
			p.add(rid, "receipt", "host", event.Seq, event.Run, map[string]any{"outcome": event.Outcome})
			p.edge(fmt.Sprintf("receipt-edge-%d", event.Seq), rid, a.ID, "records", event.Seq)
			if pageWrite(a.Action) && !in.Exploration {
				p.Round++
			}
		case "exploration":
			if !in.Exploration || event.Semantic == nil {
				return nil, errors.New("unsupported_event")
			}
			if err := p.applySemantic(event); err != nil {
				return nil, err
			}
		case "status", "waiting", "wait_requested", "wait_input", "wait_resolved", "business_verdict":
		default:
			return nil, errors.New("unsupported_event")
		}
		if oracle != nil {
			oracle(p, stamps)
		} else if err := replay.apply(ctx, p, event, stamps, protected); err != nil {
			return nil, err
		}

	}
	if len(in.Events) > 0 && in.TailHash != in.Events[len(in.Events)-1].Hash {
		return nil, errors.New("invalid_tail")
	}
	if !in.Exploration {
		p.add(goalID(in.Scope), "goal", "user_declared", 1, in.Scope, map[string]any{"goal": in.Goal})
	}
	for _, criterion := range in.Criteria {
		p.add(criterion.ID, "criterion", criterion.Source, 1, in.Scope, map[string]any{"label": criterion.Label, "status": criterion.Status, "validatorId": criterion.ValidatorID, "validatorVersion": criterion.Version})
		if criterion.Source == "code_verified" && criterion.Status == "passed" {
			p.edge(fmt.Sprintf("proof-edge-%d-%s", in.ProofSeq, criterion.ID), in.ProofRef, criterion.ID, "proves", in.ProofSeq)
		}
	}
	g := p.causal()
	cold := g.structuralCold(g.hotSet())
	for _, ref := range in.Protected {
		if n := p.index[ref]; n != nil {
			delete(cold, n.key)
		}
	}
	eligible := g.eligibleCold(cold, stamps, p.Round, coldParams{in.ColdRounds, in.MinGroup})
	// Never group nodes belonging to different runs or scope revisions.
	partitions := map[Scope]map[int64]bool{}
	for _, n := range p.Nodes {
		if eligible[n.key] {
			if partitions[n.run] == nil {
				partitions[n.run] = map[int64]bool{}
			}
			partitions[n.run][n.key] = true
		}
	}
	versions := map[int64]int{}
	byKey := map[int64]*Node{}
	for _, n := range p.Nodes {
		versions[n.key] = int(n.SourceSeq)
		byKey[n.key] = n
	}
	for _, set := range partitions {
		for _, block := range g.group(set, coldParams{in.ColdRounds, in.MinGroup}) {
			if err := ctx.Err(); err != nil {
				return nil, err
			}
			p.digest(block, versions, byKey)
		}
	}
	sort.Slice(p.Digests, func(i, j int) bool { return p.Digests[i].ID < p.Digests[j].ID })
	p.replayVisits = replay.visits
	if err := p.buildResources(); err != nil {
		return nil, err
	}
	return p, ctx.Err()
}
func (p *Projection) causal() *coldGraph {
	nodes := make([]cgNode, 0, len(p.Nodes))
	edges := []cgEdge{}
	for _, n := range p.Nodes {
		kind, state := n.Kind, "done"
		if v, ok := n.Data["state"].(string); ok {
			state = v
		}
		if kind == "fact" && n.Data["state"] == "origin" {
			kind = "begin"
		}
		if kind == "receipt" {
			kind = kindFact
		}
		if kind == kindIntent {
			switch n.Data["status"] {
			case "pending":
				state = "running"
			case "unknown_outcome":
				state = "paused"
			}
		}
		nodes = append(nodes, cgNode{n.key, kind, state})
	}
	for _, edge := range p.Edges {
		from, to := p.index[edge.From], p.index[edge.To]
		if from == nil || to == nil {
			continue
		}
		switch edge.Relation {
		case "attempts", "records":
			edges = append(edges, cgEdge{to.key, edge.Relation, from.key})
		case "yields", "derived_from", "spawns", "proves":
			edges = append(edges, cgEdge{from.key, edge.Relation, to.key})
		}
	}
	return newColdGraph(nodes, edges)
}
func (p *Projection) digest(block block, versions map[int64]int, byKey map[int64]*Node) {
	d := Digest{Members: []string{}, Anchors: []string{}, Outcomes: map[string]int{}, SourceSeqs: []int64{}}
	signatures := []string{blockSignature(block, versions)}
	for _, key := range block.Members {
		n := byKey[key]
		d.Members = append(d.Members, n.ID)
		d.SourceSeqs = append(d.SourceSeqs, n.SourceSeq)
		signatures = append(signatures, hashJSON(n))
		p.covered[n.ID] = true
		if v, ok := n.Data["outcome"].(string); ok {
			d.Outcomes[v]++
		}
	}
	for _, key := range block.Anchors {
		n := byKey[key]
		d.Anchors = append(d.Anchors, n.ID)
		signatures = append(signatures, hashJSON(n))
	}
	sort.Strings(d.Members)
	sort.Strings(d.Anchors)
	sort.Slice(d.SourceSeqs, func(i, j int) bool { return d.SourceSeqs[i] < d.SourceSeqs[j] })
	d.Signature = hashJSON([]any{"structural-v1", byKey[block.Members[0]].run, signatures})
	d.ID = "digest-" + p.ID + "-" + d.Signature
	p.Digests = append(p.Digests, d)
}
func metadata(n *Node) map[string]any {
	return map[string]any{"id": n.ID, "kind": n.Kind, "source": n.Source, "sourceSeq": n.SourceSeq}
}

// View returns bounded references and structural counts; Host overlays all safety facts.
func (p *Projection) View(budget int) map[string]any {
	graphNodes := []any{}
	chosen := map[string]bool{}
	assets := []any{}
	counts := map[string]int{}
	intents := []any{}
	frontier := []any{}
	for _, n := range p.Nodes {
		if assetKind(n.Kind) {
			counts[n.Kind]++
			asset := metadata(n)
			if n.Kind == "page" {
				asset["documentToken"] = n.Data["documentToken"]
			}
			assets = append(assets, asset)
		}
	}
	if len(assets) > 8 {
		assets = assets[len(assets)-8:]
	}
	for _, n := range p.Nodes {
		if n.Kind == "criterion" || n.ID == goalID(p.Input.Scope) {
			graphNodes = append(graphNodes, metadata(n))
			chosen[n.ID] = true
		}
	}
	for i := len(p.Nodes) - 1; i >= 0 && len(graphNodes) < 16; i-- {
		n := p.Nodes[i]
		if !chosen[n.ID] && !p.covered[n.ID] {
			graphNodes = append(graphNodes, metadata(n))
			chosen[n.ID] = true
		}
	}
	edges := []Edge{}
	for _, e := range p.Edges {
		if chosen[e.From] && chosen[e.To] {
			edges = append(edges, e)
		}
	}
	if len(edges) > 12 {
		edges = edges[len(edges)-12:]
	}
	for _, a := range p.Attempts {
		if a.Status == "pending" || a.Status == "unknown_outcome" {
			frontier = append(frontier, a)
		}
		if !p.covered[a.ID] {
			intents = append(intents, a)
		}
	}
	if len(intents) > 8 {
		intents = intents[len(intents)-8:]
	}
	digests := p.Digests
	if len(digests) > 4 {
		digests = digests[len(digests)-4:]
	}
	totalAssets := 0
	for _, count := range counts {
		totalAssets += count
	}
	value := map[string]any{
		"procedural_law_index": map[string]any{"goal": map[string]any{"text": p.Input.Goal, "source": "user_declared"}, "constraints": p.Input.Constraints, "criteria": p.Input.Criteria, "intents": intents, "frontier": frontier},
		"technical_law_index":  map[string]any{"assets": assets, "total": totalAssets, "byKind": counts},
		"knowledge_graph":      map[string]any{"nodes": graphNodes, "edges": edges, "totalEdges": len(p.Edges), "totalNodes": len(p.Nodes), "digests": digests, "digestCount": len(p.Digests), "details": "graph"},
		"active_context":       map[string]any{"recentAssets": assets, "round": p.Round, "complete": true},
	}
	if p.Input.Exploration {
		semanticIntents, semanticFrontier := []any{}, []any{}
		for _, n := range p.Nodes {
			if n.Kind == "intent" {
				semanticIntents = append(semanticIntents, metadata(n))
				if liveNode(n) {
					semanticFrontier = append(semanticFrontier, metadata(n))
				}
			}
		}
		if len(semanticIntents) > 8 {
			semanticIntents = semanticIntents[len(semanticIntents)-8:]
		}
		value["procedural_law_index"].(map[string]any)["attempts"] = intents
		value["procedural_law_index"].(map[string]any)["intents"] = semanticIntents
		value["procedural_law_index"].(map[string]any)["frontier"] = semanticFrontier
	}
	value["knowledge_graph"].(map[string]any)["views"] = p.graphSummary()
	b, _ := json.Marshal(value)
	if len(b) > budget {
		value["procedural_law_index"] = map[string]any{"details": "goal", "criteriaRef": "criteria"}
		value["technical_law_index"] = map[string]any{"total": totalAssets}
		value["knowledge_graph"] = map[string]any{"details": "graph", "totalEdges": len(p.Edges), "digestCount": len(p.Digests)}
		value["knowledge_graph"].(map[string]any)["views"] = p.graphSummary()
		value["active_context"] = map[string]any{"recentAssets": []any{}, "round": p.Round, "complete": false, "truncated": true}
	}
	return value
}

// Detail exposes only sanitized projection data and rejects expired digest IDs.
func (p *Projection) Detail(ref string) (any, error) {
	if ref == "graph:assets" || ref == "graph:exploration" || len(ref) > 9 && ref[:9] == "resource-" {
		return p.dualDetail(ref)
	}
	if ref == "graph" {
		nodes := append([]*Node{}, p.Nodes...)
		edges := append([]Edge{}, p.Edges...)
		for _, d := range p.Digests {
			nodes = append(nodes, &Node{ID: d.ID, TaskID: p.Input.Scope.TaskID, Kind: "digest", Source: "derived", Data: map[string]any{"signature": d.Signature}})
			for _, id := range d.Members {
				edges = append(edges, Edge{ID: d.ID + ":" + id, TaskID: p.Input.Scope.TaskID, From: d.ID, To: id, Relation: "covers"})
			}
		}
		return map[string]any{"nodes": nodes, "edges": edges, "digests": p.Digests}, nil
	}
	if n := p.index[ref]; n != nil {
		return n, nil
	}
	for _, d := range p.Digests {
		if d.ID == ref {
			return d, nil
		}
	}
	return nil, errors.New("stale_reference")
}
