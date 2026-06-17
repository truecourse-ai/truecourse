// Generic statement-tree AST types shared by the ohm front-end, the resolver,
// and the per-kind lifters. The `.tc` source is parsed by the strict ohm
// grammar in `../parser-ohm/`; this directory now holds only the AST shapes
// that pipeline produces and consumes.
export type {
  FileNode,
  StatementNode,
  HeadToken,
  ListItem,
  SrcLoc,
} from './ast.js';
