
interface DataTransformer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialize: (object: any) => any;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deserialize: (object: any) => any;
}

const superjsonTransformer: DataTransformer = {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  serialize: (object: any) => JSON.stringify(object),
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  deserialize: (object: any) => JSON.parse(object as string),
};



interface RPCTransformer {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  input: { serialize: (obj: any) => any; deserialize: (obj: any) => any };
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  output: { serialize: (obj: any) => any; deserialize: (obj: any) => any };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpcTransformer: RPCTransformer = {
  input: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serialize: (obj: any) => JSON.stringify(obj),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deserialize: (obj: any) => JSON.parse(obj as string),
  },
  output: {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    serialize: (obj: any) => JSON.stringify(obj),
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    deserialize: (obj: any) => JSON.parse(obj as string),
  },
};
