import fs from 'fs'
import path from 'path'

export interface AppSettings {
  // Notifications — Slack
  slackWebhookUrl: string
  // Notifications — Email / SMTP
  // Notifications — Microsoft Teams
  teamsWebhookUrl: string
  // Notifications — Custom Webhook
  customWebhookUrl: string
  // Notifications — Team / On-Call
  notificationTeam: string
  notifyCooldownMinutes: number
  // Notifications — Email / SMTP
  alertEmailEnabled: boolean
  alertRecipients: string   // comma-separated
  smtpHost: string
  smtpPort: number
  smtpUser: string
  smtpPassword: string
  smtpFrom: string
  // AI Copilot — Multi-provider support
  aiProvider: 'groq' | 'openai' | 'google' | 'anthropic' | 'custom'
  aiModel: string
  aiApiKey: string
  aiBaseUrl: string  // for custom/self-hosted providers
  // Legacy (for backward compatibility)
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
    teamsWebhookUrl: '',
    customWebhookUrl: '',
    notificationTeam: '',
    notifyCooldownMinutes: 30,
    alertEmailEnabled: false,
  alertRecipients: '',
  smtpHost: '',
  smtpPort: 587,
  smtpUser: '',
  smtpPassword: '',
  smtpFrom: '',
  aiProvider: 'groq',
  aiModel: 'llama-3.3-70b-versatile',
  aiApiKey: process.env.GROQ_API_KEY ?? '',
  aiBaseUrl: '',
  groqApiKey: process.env.GROQ_API_KEY ?? '',  // backward compatibility
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
  const tempFile = `${SETTINGS_FILE}.${process.pid}.tmp`
  fs.writeFileSync(tempFile, JSON.stringify(updated, null, 2), 'utf8')
  fs.renameSync(tempFile, SETTINGS_FILE)
  return updated
}
