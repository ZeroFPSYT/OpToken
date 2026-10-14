export type Effort = 'low' | 'medium' | 'high' | 'xhigh' | 'max'
export type Limit = { kind: string; percentUsed: number; resetsAt?: string }
export type Measure = {
  limits: Limit[]
  contextTokens?: number
  /** Uso semanal menos el tiempo transcurrido de la semana, en puntos. */
  pace?: number
}
export type Settings = {
  /** Retomar tras el límite cuando trabaja solo. */
  resume: 'ask' | 'always' | 'never'
  /** Aprovechar el límite semanal que vence. */
  weekly: boolean
  /** Repositorio (owner/repo) para la rutina semanal. */
  project?: string
  /** Días antes del reinicio semanal: ambos, 2 o 1. */
  days?: 'both' | '2' | '1'
}
export type Step = { agent: string; model: string; sent?: string; read: number; wrote: number; input: number }

declare module 'claude-code' {
  interface PluginState {
    'optoken': {
      measure: Measure | null
      wanted: Effort | null
      steps: Step[]
      strikes: Record<string, number>
      pending: string[]
      warned: number[]
      solo: boolean
    }
  }
}
