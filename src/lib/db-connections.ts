import { Pool } from 'pg'
import mysql from 'mysql2/promise'
import { MongoClient } from 'mongodb'
import Redis from 'ioredis'
import * as mssql from 'mssql'
import type { DbConnection } from './db-store'

// Connection pools per DB id
const pgPools    = new Map<string, Pool>()
const mysqlPools = new Map<string, mysql.Pool>()
const mongos     = new Map<string, MongoClient>()
const redises    = new Map<string, Redis>()
const mssqlPools = new Map<string, mssql.ConnectionPool>()

export async function getPgPool(db: DbConnection): Promise<Pool | null> {
  if (pgPools.has(db.id)) return pgPools.get(db.id)!
  try {
    const pool = new Pool({
      host: db.host, port: db.port,
      database: db.database, user: db.username,
      password: db.passwordEnc,
      max: 3, connectionTimeoutMillis: 5000, idleTimeoutMillis: 30000,
    })
    // Test connection
    const client = await pool.connect()
    client.release()
    pgPools.set(db.id, pool)
    return pool
  } catch (e) {
    console.error(`[db-connections] PG connect failed for ${db.name}:`, (e as Error).message)
    return null
  }
}

export async function getMysqlPool(db: DbConnection): Promise<mysql.Pool | null> {
  if (mysqlPools.has(db.id)) return mysqlPools.get(db.id)!
  try {
    const pool = mysql.createPool({
      host: db.host, port: db.port,
      database: db.database, user: db.username,
      password: db.passwordEnc,
      connectionLimit: 3, connectTimeout: 5000,
    })
    const conn = await pool.getConnection()
    conn.release()
    mysqlPools.set(db.id, pool)
    return pool
  } catch (e) {
    console.error(`[db-connections] MySQL connect failed for ${db.name}:`, (e as Error).message)
    return null
  }
}

export async function getMongoClient(db: DbConnection): Promise<MongoClient | null> {
  if (mongos.has(db.id)) {
    const c = mongos.get(db.id)!
    return c
  }
  try {
    const authSource = db.username === 'admin' ? 'admin' : db.database
    const uri = db.username
      ? `mongodb://${encodeURIComponent(db.username)}:${encodeURIComponent(db.passwordEnc)}@${db.host}:${db.port}/${db.database}?authSource=${authSource}`
      : `mongodb://${db.host}:${db.port}/${db.database}`
    const client = new MongoClient(uri, { serverSelectionTimeoutMS: 5000, maxPoolSize: 3 })
    await client.connect()
    mongos.set(db.id, client)
    return client
  } catch (e) {
    console.error(`[db-connections] Mongo connect failed for ${db.name}:`, (e as Error).message)
    return null
  }
}

export async function getMssqlPool(db: DbConnection): Promise<mssql.ConnectionPool | null> {
  if (mssqlPools.has(db.id)) return mssqlPools.get(db.id)!
  try {
    const pool = new mssql.ConnectionPool({
      server: db.host,
      port: db.port,
      database: db.database,
      user: db.username,
      password: db.passwordEnc,
      options: { encrypt: db.ssl, trustServerCertificate: !db.ssl },
      connectionTimeout: 5000,
      requestTimeout: 30000,
      pool: { max: 3, min: 0, idleTimeoutMillis: 30000 },
    })
    await pool.connect()
    mssqlPools.set(db.id, pool)
    return pool
  } catch (e) {
    console.error(`[db-connections] MSSQL connect failed for ${db.name}:`, (e as Error).message)
    return null
  }
}

export async function getRedisClient(db: DbConnection): Promise<Redis | null> {
  if (redises.has(db.id)) return redises.get(db.id)!
  try {
    const r = new Redis({
      host: db.host, port: db.port,
      password: db.passwordEnc || undefined,
      lazyConnect: true, connectTimeout: 5000,
      maxRetriesPerRequest: 1,
    })
    await r.connect()
    redises.set(db.id, r)
    return r
  } catch (e) {
    console.error(`[db-connections] Redis connect failed for ${db.name}:`, (e as Error).message)
    return null
  }
}

export async function testConnection(db: DbConnection): Promise<{ ok: boolean; message: string; version?: string }> {
  try {
    switch (db.engine) {
      case 'postgresql': {
        const pool = await getPgPool(db)
        if (!pool) return { ok: false, message: 'Connection refused or credentials invalid' }
        const res = await pool.query('SELECT version()')
        return { ok: true, message: 'Connected', version: res.rows[0].version?.split(' ').slice(0,2).join(' ') }
      }
      case 'mysql': {
        const pool = await getMysqlPool(db)
        if (!pool) return { ok: false, message: 'Connection refused or credentials invalid' }
        const [rows] = await pool.query('SELECT version() as v') as [{ v: string }[], unknown]
        return { ok: true, message: 'Connected', version: `MySQL ${rows[0]?.v}` }
      }
      case 'mongodb': {
        const client = await getMongoClient(db)
        if (!client) return { ok: false, message: 'Connection refused or credentials invalid' }
        const info = await client.db('admin').command({ buildInfo: 1 })
        return { ok: true, message: 'Connected', version: `MongoDB ${info.version}` }
      }
      case 'redis': {
        const r = await getRedisClient(db)
        if (!r) return { ok: false, message: 'Connection refused or credentials invalid' }
        const info = await r.info('server')
        const ver = info.match(/redis_version:(.+)/)?.[1]?.trim()
        return { ok: true, message: 'Connected', version: `Redis ${ver}` }
      }
      case 'sqlserver': {
        const pool = await getMssqlPool(db)
        if (!pool) return { ok: false, message: 'Connection refused or credentials invalid' }
        const result = await pool.request().query('SELECT @@VERSION AS v')
        const ver = (result.recordset[0]?.v as string ?? '').split('\n')[0].trim()
        return { ok: true, message: 'Connected', version: ver.substring(0, 50) }
      }
      default:
        return { ok: false, message: `Engine '${db.engine}' not yet supported for real connections` }
    }
  } catch (e) {
    return { ok: false, message: (e as Error).message }
  }
}

export function closeAll() {
  pgPools.forEach(p => p.end().catch(() => {}))
  mysqlPools.forEach(p => p.end().catch(() => {}))
  mongos.forEach(c => c.close().catch(() => {}))
  redises.forEach(r => r.quit().catch(() => {}))
  pgPools.clear(); mysqlPools.clear(); mongos.clear(); redises.clear()
}
