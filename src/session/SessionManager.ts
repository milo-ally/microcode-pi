import * as path from 'path'
import * as os from 'os'
import {
  JsonlSessionRepo,
  Session,
  type JsonlSessionMetadata,
  type AgentMessage,
} from '@earendil-works/pi-agent-core'
import { NodeFileSystem } from './NodeFileSystem.ts'
import { replaceImageBlocksForPersistence } from './imageSerializer.ts'

const SESSIONS_DIR = path.join(os.homedir(), '.microcode', 'sessions')

/**
 * Manages session lifecycle: create, persist, resume, list.
 * Wraps pi-agent-core's JsonlSessionRepo and Session.
 */
export class SessionManager {
  private repo: JsonlSessionRepo
  private session: Session | null = null
  private metadata: JsonlSessionMetadata | null = null
  private savedMessageCount = 0

  constructor() {
    const fs = new NodeFileSystem('/')
    this.repo = new JsonlSessionRepo({
      fs,
      sessionsRoot: SESSIONS_DIR,
    })
  }

  /**
   * Create a new session for the given working directory.
   */
  async create(cwd: string): Promise<string> {
    this.session = await this.repo.create({ cwd })
    this.metadata = await this.session.getMetadata()
    this.savedMessageCount = 0
    return this.metadata.id
  }

  /**
   * Resume an existing session from metadata.
   */
  async open(meta: JsonlSessionMetadata): Promise<AgentMessage[]> {
    this.session = await this.repo.open(meta)
    this.metadata = meta
    const context = await this.session.buildContext()
    this.savedMessageCount = context.messages.length
    return context.messages
  }

  /**
   * List available sessions, optionally filtered by cwd.
   */
  async list(cwd?: string): Promise<JsonlSessionMetadata[]> {
    return this.repo.list({ cwd })
  }

  /**
   * Get the most recent session for a given cwd, if any.
   */
  async getLatestSession(cwd: string): Promise<JsonlSessionMetadata | null> {
    const sessions = await this.list(cwd)
    return sessions[0] ?? null
  }

  /**
   * Persist new messages to the session.
   * Only appends messages that haven't been saved yet.
   */
  async saveMessages(messages: AgentMessage[]): Promise<void> {
    if (!this.session) return

    // Append only new messages, with image blocks replaced by text references
    for (let i = this.savedMessageCount; i < messages.length; i++) {
      const serialized = replaceImageBlocksForPersistence(messages[i])
      await this.session.appendMessage(serialized)
    }
    this.savedMessageCount = messages.length
  }

  /**
   * Record a compaction event in the session.
   */
  async saveCompaction(
    summary: string,
    firstKeptEntryId: string,
    tokensBefore: number,
  ): Promise<void> {
    if (!this.session) return
    await this.session.appendCompaction(summary, firstKeptEntryId, tokensBefore)
  }

  /**
   * Load all messages from the session.
   */
  async loadMessages(): Promise<AgentMessage[]> {
    if (!this.session) return []
    const context = await this.session.buildContext()
    return context.messages
  }

  /**
   * Get the current session instance.
   */
  getSession(): Session | null {
    return this.session
  }

  /**
   * Get the current session metadata.
   */
  getMetadata(): JsonlSessionMetadata | null {
    return this.metadata
  }

  /**
   * Get the session ID.
   */
  getSessionId(): string | null {
    return this.metadata?.id ?? null
  }

  /**
   * Delete a session.
   */
  async delete(meta: JsonlSessionMetadata): Promise<void> {
    await this.repo.delete(meta)
  }

  /**
   * Reset saved message count (e.g., after compaction replaces all messages).
   */
  resetSavedCount(): void {
    this.savedMessageCount = 0
  }

  /**
   * Set saved message count to a specific value.
   * Use after compaction to avoid re-saving messages that are already in the session.
   */
  setSavedMessageCount(count: number): void {
    this.savedMessageCount = count
  }
}
