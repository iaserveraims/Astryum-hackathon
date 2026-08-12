/**
 * asyncHandler — Express 4 does NOT catch a rejected promise returned by an
 * async route handler: the rejection lands in the process-level
 * unhandledRejection listener (which only logs) and the response is never
 * sent, so the client hangs forever. This wrapper forwards the rejection to
 * next(err) so the global error middleware (index-simple.ts) answers with its
 * clean 500.
 *
 * Wrap any handler with an `await` outside a try/catch. Wrapping a handler
 * that already try/catches everything is harmless — the catch simply never
 * fires.
 */
import { NextFunction, Request, RequestHandler, Response } from 'express';

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>,
): RequestHandler {
  return (req, res, next) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
}
