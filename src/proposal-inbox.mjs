import { randomUUID } from 'node:crypto'

const maxPendingPerSession = 8
const proposalLifetimeMs = 30 * 60 * 1000

export function createProposalInbox(now = Date.now) {
  const sessions = new WeakMap()

  function pending(agent) {
    const proposals = sessions.get(agent)
    if (!proposals) return []
    const cutoff = now() - proposalLifetimeMs
    const live = proposals.filter(proposal => proposal.createdAt > cutoff)
    if (live.length !== proposals.length) sessions.set(agent, live)
    return live
  }

  return {
    add(agent, proposal) {
      const entry = { ...proposal, id: randomUUID(), createdAt: now() }
      sessions.set(agent, [entry, ...pending(agent)].slice(0, maxPendingPerSession))
      return entry.id
    },
    list(agent, file) {
      return pending(agent).filter(proposal => proposal.edit.file === file)
    },
    remove(agent, id) {
      sessions.set(agent, pending(agent).filter(proposal => proposal.id !== id))
    },
  }
}
