import fastify from 'fastify'

const app = fastify({ logger: false })

app.get('/health', async () => {
  await Promise.resolve()
  return { ok: true as const, service: 'render-api', status: 'pending-implementation' }
})

const port = 3102
app
  .listen({ port, host: '127.0.0.1' })
  .then(() => {
    console.log(`render-api listening on ${port}`)
  })
  .catch((err: unknown) => {
    console.error(err)
    process.exit(1)
  })
