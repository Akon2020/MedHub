/**
 * Configurable clinical forms (docs/modules/form.md): definition schema, safe
 * expression language and headless engine, shared by client and server.
 */
export * from './schema';
export * from './engine';
export {
  checkExpression,
  compile,
  evaluate,
  ExprError,
  MAX_EXPRESSION_LENGTH,
  type ExprEnv,
  type ExprErrorCode,
} from './expr';
export { consultationGeneral } from './templates/consultation-general';
