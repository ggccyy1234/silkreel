import './test-recorder.js'
import { describe, expect, it } from 'vitest'
import { createPost } from './post.js'

describe('createPost', () => {
  it('returns undefined where WebGL2 is unavailable (happy-dom), exercising the drawImage fallback', () => {
    expect(createPost()).toBeUndefined()
  })
})
