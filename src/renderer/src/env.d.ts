/// <reference types="vite/client" />
import type { MineHarborApi } from '../../shared/types'

declare global {
  interface Window {
    mineHarbor: MineHarborApi
  }
}

export {}
