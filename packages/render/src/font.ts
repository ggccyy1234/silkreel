import React from 'react'
import { continueRender, delayRender } from 'remotion'
import url from './assets/JetBrainsMono-Medium.woff2'

export const FONT = '"SilkMono", ui-monospace, Menlo, monospace'

let loaded: Promise<void> | undefined

export function loadFont(): Promise<void> {
  if (typeof FontFace === 'undefined') return Promise.resolve()
  loaded ??= new FontFace('SilkMono', `url(${url})`).load().then((f) => {
    document.fonts.add(f)
  })
  return loaded
}

export function useFont(): void {
  const [handle] = React.useState(() => delayRender('font'))
  React.useEffect(() => {
    void loadFont().finally(() => {
      continueRender(handle)
    })
  }, [handle])
}
