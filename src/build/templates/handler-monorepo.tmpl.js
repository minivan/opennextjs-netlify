import {
  createRequestContext,
  runWithRequestContext,
} from '{{cwd}}/.netlify/dist/run/handlers/request-context.cjs'
import { getTracer } from '{{cwd}}/.netlify/dist/run/handlers/tracer.cjs'
import tracing from '{{cwd}}/.netlify/dist/run/handlers/tracing.js'

process.chdir('{{cwd}}')

let cachedHandler
export default async function (req, context) {
  if (process.env.NETLIFY_OTLP_TRACE_EXPORTER_URL) {
    tracing.start()
  }

  const requestContext = createRequestContext(
    req.headers.get('x-nf-debug-logging') || req.headers.get('x-next-debug-logging'),
  )
  const tracer = getTracer()

  const handlerResponse = await runWithRequestContext(requestContext, () => {
    return tracer.withActiveSpan('Next.js Server Handler', async (span) => {
      span.setAttributes({
        'account.id': context.account.id,
        'deploy.id': context.deploy.id,
        'request.id': context.requestId,
        'site.id': context.site.id,
        'http.method': req.method,
        'http.target': req.url,
        monorepo: true,
        cwd: '{{cwd}}',
      })
      if (!cachedHandler) {
        const { default: handler } = await import('{{nextServerHandler}}')
        cachedHandler = handler
      }
      const response = await cachedHandler(req, context)
      span.setAttributes({
        'http.status_code': response.status,
      })
      return response
    })
  })

  if (requestContext.serverTiming) {
    handlerResponse.headers.set('server-timing', requestContext.serverTiming)
  }

  return handlerResponse
}

export const config = {
  path: '/*',
  preferStatic: true,
}
