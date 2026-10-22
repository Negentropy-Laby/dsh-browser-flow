// SPDX-License-Identifier: Apache-2.0
// Worker is an owned helper launched only by the Browser Flow Host plugin.
package main

import (
	"flag"
	"fmt"
	graph "github.com/Negentropy-Laby/dsh-browser-flow/graph-core"
	"os"
)

func main() {
	maxFrame := flag.Int("max-frame", 8*1024*1024, "maximum protocol frame bytes")
	maxDetail := flag.Int("max-detail", 32*1024*1024, "maximum complete detail bytes")
	flag.Parse()
	if flag.NArg() != 0 {
		os.Exit(2)
	}
	if err := graph.Serve(os.Stdin, os.Stdout, *maxFrame, *maxDetail); err != nil {
		fmt.Fprintln(os.Stderr, "graph worker: protocol terminated")
		os.Exit(1)
	}
}
