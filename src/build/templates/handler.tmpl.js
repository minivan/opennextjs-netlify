import serverHandler from './dist/run/handlers/server.js'
import tracing, { trace } from './dist/run/handlers/tracing.js'

export default async function handler(req, context) {
  if (process.env.NETLIFY_OTLP_TRACE_EXPORTER_URL) {
    tracing.start()
  }

  /** @type {import('@opentelemetry/api').Tracer} */
  const tracer = trace.getTracer('Next.js Runtime')
  return tracer.startActiveSpan('Next.js Server Handler', async (span) => {
    try {
      span.setAttributes({
        'account.id': context.account.id,
        'deploy.id': context.deploy.id,
        'request.id': context.requestId,
        'site.id': context.site.id,
        'http.method': req.method,
        'http.target': req.url,
        monorepo: false,
        cwd: process.cwd(),
      })
      const response = await serverHandler(req, context)
      span.setAttributes({
        'http.status_code': response.status,
      })
      return response
    } catch (error) {
      span.recordException(error)
      if (error instanceof Error) {
        span.addEvent({ name: error.name, message: error.message })
      }
      throw error
    } finally {
      span.end()
    }
  })
}

export const config = {
  path: '/*',
  preferStatic: true,
}
