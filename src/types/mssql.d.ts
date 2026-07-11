declare module 'mssql' {
  interface IResult<T> { recordset: T[]; rowsAffected: number[] }
  class Request {
    input(name: string, value: unknown): this
    query<T = Record<string, unknown>>(sql: string): Promise<IResult<T>>
  }
  class ConnectionPool {
    constructor(config: Record<string, unknown>)
    connect(): Promise<this>
    request(): Request
    close(): Promise<void>
  }
  export { ConnectionPool, Request, IResult }
}
