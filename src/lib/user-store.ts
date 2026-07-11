import fs from 'fs'
import path from 'path'
import crypto from 'crypto'

export type UserRole = 'admin' | 'editor' | 'viewer'

export interface User {
  id: string
  email: string
  name: string
  role: UserRole
  passwordHash: string
  passwordSalt: string
  createdAt: string
  lastLogin?: string
}

const DATA_DIR = path.join(process.cwd(), 'data')
const USERS_FILE = path.join(DATA_DIR, 'users.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

function readUsers(): User[] {
  ensureDir()
  if (!fs.existsSync(USERS_FILE)) {
    // Seed default admin
    const admin = buildUser({ email: 'admin@vyndb.local', name: 'Admin', role: 'admin', password: 'admin123' })
    const viewer = buildUser({ email: 'viewer@vyndb.local', name: 'Viewer', role: 'viewer', password: 'viewer123' })
    const users = [admin, viewer]
    fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8')
    return users
  }
  try {
    return JSON.parse(fs.readFileSync(USERS_FILE, 'utf8')) as User[]
  } catch {
    return []
  }
}

function writeUsers(users: User[]) {
  ensureDir()
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2), 'utf8')
}

function buildUser(data: { email: string; name: string; role: UserRole; password: string }): User {
  const { hash, salt } = hashPassword(data.password)
  return {
    id: crypto.randomUUID(),
    email: data.email,
    name: data.name,
    role: data.role,
    passwordHash: hash,
    passwordSalt: salt,
    createdAt: new Date().toISOString(),
  }
}

export function hashPassword(password: string): { hash: string; salt: string } {
  const salt = crypto.randomBytes(16).toString('hex')
  const hash = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  return { hash, salt }
}

export function verifyPassword(password: string, hash: string, salt: string): boolean {
  const derived = crypto.pbkdf2Sync(password, salt, 100000, 32, 'sha256').toString('hex')
  return crypto.timingSafeEqual(Buffer.from(derived, 'hex'), Buffer.from(hash, 'hex'))
}

export function listUsers(): User[] { return readUsers() }

export function findUserByEmail(email: string): User | null {
  return readUsers().find(u => u.email.toLowerCase() === email.toLowerCase()) ?? null
}

export function findUserById(id: string): User | null {
  return readUsers().find(u => u.id === id) ?? null
}

export function createUser(data: { email: string; name: string; role: UserRole; password: string }): User {
  const users = readUsers()
  if (users.find(u => u.email.toLowerCase() === data.email.toLowerCase())) {
    throw new Error('Email already exists')
  }
  const user = buildUser(data)
  users.push(user)
  writeUsers(users)
  return user
}

export function updateUser(id: string, updates: Partial<Pick<User, 'name' | 'role'> & { password?: string }>): User {
  const users = readUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx === -1) throw new Error('User not found')
  if (updates.name) users[idx].name = updates.name
  if (updates.role) users[idx].role = updates.role
  if (updates.password) {
    const { hash, salt } = hashPassword(updates.password)
    users[idx].passwordHash = hash
    users[idx].passwordSalt = salt
  }
  writeUsers(users)
  return users[idx]
}

export function deleteUser(id: string): void {
  const users = readUsers()
  const filtered = users.filter(u => u.id !== id)
  if (filtered.length === users.length) throw new Error('User not found')
  writeUsers(filtered)
}

export function touchLastLogin(id: string): void {
  const users = readUsers()
  const idx = users.findIndex(u => u.id === id)
  if (idx !== -1) {
    users[idx].lastLogin = new Date().toISOString()
    writeUsers(users)
  }
}
