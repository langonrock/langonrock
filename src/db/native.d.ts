declare module '*.node' {
  const binding: {
    tryLock: (path: string, shared: boolean) => object | null
    release: (handle: object) => void
    flush: (path: string, directory: boolean) => void
    replace: (source: string, target: string) => void
    order: (path: string) => void
  }

  export default binding
}
