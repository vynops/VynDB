import { randomBytes } from 'node:crypto'
import { chmodSync, readFileSync, writeFileSync } from 'node:fs'
import path from 'node:path'

const envPath = process.argv[2]
  ? path.resolve(process.argv[2])
  : path.join(process.cwd(), '.env.local')
const keys = [
  {
    name: 'VYNDB_SECRET',
    defaults: [
      'vyndb-fallback-dev-secret-change-in-prod',
      'vyndb_jwt_secret_change_this_2024',
      'vyndb_jwt_secret_change_in_prod_2024',
    ],
  },
  {
    name: 'VYNDB_COLLECTOR_TOKEN',
    defaults: ['vyndb_collector_token_lab_2024'],
  },
]

let contents = ''
try {
  contents = readFileSync(envPath, 'utf8')
} catch (error) {
  if (error.code !== 'ENOENT') throw error
}

const lines = contents ? contents.split(/\r?\n/) : []
const generated = new Set()
let updated = false

for (const { name, defaults } of keys) {
  const expression = new RegExp(`^\\s*(?:export\\s+)?${name}\\s*=\\s*(.*?)\\s*$`)
  const index = lines.findIndex(line => expression.test(line))
  const match = index === -1 ? null : lines[index].match(expression)
  const rawValue = match?.[1] ?? ''
  const value = rawValue.replace(/^(?:"(.*)"|'(.*)')$/, (_, doubleQuoted, singleQuoted) => doubleQuoted ?? singleQuoted)
  if (value && Buffer.byteLength(value, 'utf8') >= 32 && !defaults.includes(value)) continue

  let secret
  do {
    secret = randomBytes(32).toString('base64url')
  } while (generated.has(secret))
  generated.add(secret)
  const assignment = `${name}=${secret}`
  if (index === -1) lines.push(assignment)
  else lines[index] = assignment
  updated = true
}

if (updated) {
  const output = `${lines.filter((line, index) => line || index < lines.length - 1).join('\n').replace(/\n*$/, '')}\n`
  writeFileSync(envPath, output, { encoding: 'utf8', mode: 0o600 })
  console.log(`Generated or replaced required secrets in ${envPath}.`)
} else {
  console.log(`Required secrets are already configured in ${envPath}.`)
}

if (process.platform !== 'win32') chmodSync(envPath, 0o600)