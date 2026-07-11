import fs from 'fs'
import path from 'path'

export interface AppSettings {
  // Notifications — Slack
  slackWebhookUrl: string
  // Notifications — Email / SMTP
  alertEmailEnabled: boolean
  alertRecipients: string   // comma-separated
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpFrom: string
  // AI Copilot (Groq)
  aiModel: string
  groqApiKey: string
  // GraphQL endpoint (optional data source)
  graphqlEndpointUrl: string
  graphqlAuthToken: string
  // General
  defaultRefreshInterval: number
  timezone: string
  // Alerting thresholds
  slowQueryThresholdMs: number
  replicationLagAlertSec: number
  connectionPoolPctAlert: number
  backupRpoBreachAlertHrs: number
  // Backup
  backupRetentionDays: number
  backupPath: string
}

const DEFAULTS: AppSettings = {
  slackWebhookUrl: '',
  alertEmailEnabled: false,
  alertRecipients: '',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  aiModel: 'llama-3.3-70b-versatile',
  groqApiKey: process.env.GROQ_API_KEY ?? '',
  graphqlEndpointUrl: '',
  graphqlAuthToken: '',
  defaultRefreshInterval: 30,
  timezone: 'UTC',
  slowQueryThresholdMs: 1000,
  replicationLagAlertSec: 30,
  connectionPoolPctAlert: 80,
  backupRpoBreachAlertHrs: 25,
  backupRetentionDays: 7,
  backupPath: '',
}

const DATA_DIR = path.join(process.cwd(), 'data')
const SETTINGS_FILE = path.join(DATA_DIR, 'settings.json')

function ensureDir() {
  if (!fs.existsSync(DATA_DIR)) fs.mkdirSync(DATA_DIR, { recursive: true })
}

export function getSettings(): AppSettings {
  ensureDir()
  if (!fs.existsSync(SETTINGS_FILE)) return { ...DEFAULTS }
  try {
    const raw = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Partial<AppSettings>
    return { ...DEFAULTS, ...raw }
  } catch {
    return { ...DEFAULTS }
  }
}

export function saveSettings(partial: Partial<AppSettings>): AppSettings {
  const current = getSettings()
  const updated: AppSettings = { ...current, ...partial }
  ensureDir()
  fs.writeFileSync(SETTINGS_FILE, JSON.stringify(updated, null, 2), 'utf8')
  return updated
}
