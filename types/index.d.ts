export type PrInfo = {
  number: number
  title: string
  url: string
  base: string
  head: string
  headSha: string
  cwd: string
}

export type Severity = 'high' | 'medium' | 'low'

export type Finding = {
  id: string
  severity: Severity
  line: number
  side: 'new' | 'old'
  message: string
}

export type FileReview = {
  summary: string
  findings: Finding[]
  callSites?: number
}

export type PrFile = {
  path: string
  status: 'A' | 'M' | 'D' | 'R'
  added: number
  removed: number
  diff: string
  review: FileReview | null
}

export type ReviewComment = {
  id: string
  path: string
  start: number
  end: number
  where: string
  quote: string
  body: string
  findingId: string | null
}

export type Draft = { path: string; start: number; end: number; text: string; findingId: string | null; mode: 'comment' | 'post'; editId: string | null }

declare module 'claude-code' {
  interface PluginState {
    'pr-live-review': {
      pr: PrInfo | null
      files: PrFile[]
      selected: string | null
      status: string
      cursor: number
      card: number
      anchor: number | null
      draft: Draft | null
      comments: ReviewComment[]
      viewed: string[]
      ignored: string[]
      posted: string[]
    }
  }
}
