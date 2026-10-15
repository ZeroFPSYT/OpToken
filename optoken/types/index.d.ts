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
/** Una tarea planeada con la herramienta `plan`: lo estimado y, al cerrarla, lo real. */
export type Plan = {
  task: string
  size: 'S' | 'M' | 'L'
  /** Costo estimado en % de la ventana de 5 h. */
  cost: number
  effort: Effort
  delegate?: string
  /** % de la ventana de 5 h al empezar (para medir el costo real). */
  fiveAtStart?: number
  startedAt: number
  /** Al cerrar: costo real en % de la ventana (sin dato si la ventana se reinició en el medio). */
  real?: number
  endedAt?: number
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
      plan: Plan | null
      /** Llamadas a herramientas con esfuerzo alto desde que empezó el plan. */
      highCalls: number
      /** Comandos seguidos que fallaron (cualquier comando). */
      failRun: number
      /** ¿Hubo cambios (ediciones o commits) en este turno? */
      worked: boolean
      /** Turnos seguidos sin cambios mientras trabaja solo. */
      idle: number
    }
  }
}
