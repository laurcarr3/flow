export const document = (id = "hello", deps = "[]") =>
  `---\nid: ${id}\nstatus: draft\ndepends_on: ${deps}\n---\n# Hello world\n\n## Outcome\nUsers can print a friendly greeting.\n\n## Requirements\nPrint hello to standard output.\n\n## Acceptance criteria\nThe greeting command prints hello.\n\n## Out of scope\nLocalization.\n\n## Open questions\nNone.\n`;
