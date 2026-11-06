export type Todo = { title: string; isDone: boolean; taskId?: string; parent?: string }
export type Mood = 'happy' | 'focus' | 'cheer' | 'worry' | 'sleep'
export type Board = { todos: Todo[]; mood: Mood; say: string; checkedAt?: number }

declare module 'claude-code' {
  interface PluginState {
    secretary: { board: Shaped<Board> }
  }
}
