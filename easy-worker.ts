interface Output {
  id: number,
  result: any
}

export class EasyWorker {
  impl: Worker
  resolvers = new Map<number, (result: any) => void>()
  counter = 1

  constructor(private readonly dependencies: [string]) {

    const blobURL = URL.createObjectURL(new Blob([
        `
        ${dependencies.join('\n')}
        
        self.onmessage = function (msg) {
          let func = new Function("return " + msg.data.code)();
          let result = func(...msg.data.parameters)
          postMessage({
            id: msg.data.id,
            result: result
          })
        }
        `
      ],
      {
        type: 'application/javascript'
      }
    ));
    this.impl = new Worker(blobURL)

    const theResolvers = this.resolvers
    this.impl.onmessage = function (msg: MessageEvent<Output>) {
      console.log("receive: ", msg)
      const resolver = theResolvers.get(msg.data.id)
      if (resolver != null) {
        resolver(msg.data.result)
      }
    }
  }

  async run<P0, R>(func: (p0: P0)=>R, p0: P0): Promise<R>;
  async run<P0, P1, R>(func: (p0: P0, p1: P1)=>R, p0: P0, p1: P1): Promise<R>;
  async run<P0, P1, P2, R>(func: (p0: P0, p1: P1, p2: P2)=>R, p0: P0, p1: P1, p2: P2): Promise<R>;
  async run<P0, P1, P2, P3, R>(func: (p0: P0, p1: P1, p2: P2, p3: P3)=>R, p0: P0, p1: P1, p2: P2, p3: P3): Promise<R>;
  async run<P0, P1, P2, P3, P4, R>(func: (p0: P0, p1: P1, p2: P2, p3: P3, p4: P4)=>R, p0: P0, p1: P1, p2: P2, p3: P3, p4: P4): Promise<R>;

  async run(func: Function, ...parameters: any): Promise<any> {
    const id = ++this.counter

    this.impl.postMessage({
      id: id,
      code: func.toString(),
      parameters: parameters
    })
    return new Promise<any>( resolve => {
      this.resolvers.set(id, resolve)
    })
  }
}