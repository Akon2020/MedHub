export {
  accountMfaConfirmRoute,
  accountMfaDisableRoute,
  accountMfaSetupRoute,
  accountLocaleRoute,
  accountPasswordRoute,
  accountRecoveryCodesRoute,
  accountRevokeSessionsRoute,
  accountSecurityRoute,
  initialPasswordRoute,
  loginRoute,
  logoutRoute,
  meRoute,
  mfaActivateRoute,
  mfaEnrollRoute,
  mfaVerifyRoute,
  registerDeviceRoute,
  stepUpRoute,
} from './routes';
export {
  departmentCreateRoute,
  departmentUpdateRoute,
  organizationRoute,
  organizationUpdateRoute,
  securityEventsRoute,
  siteCreateRoute,
  siteUpdateRoute,
} from './organization-routes';
export { deviceRevokeRoute, devicesRoute, deviceTokensRoute } from './devices-routes';
export {
  configDiscardRoute,
  configDraftRoute,
  configPublishRoute,
  configRestoreRoute,
  configurationRoute,
} from './configuration-routes';
export {
  userCreateRoute,
  userResetMfaRoute,
  userResetPasswordRoute,
  usersRoute,
  userStatusRoute,
  userUnlockRoute,
  userUpdateRoute,
} from './users-routes';
export { roleCreateRoute, rolesRoute, roleUpdateRoute } from './roles-routes';
export {
  catalogsRoute,
  choiceImportRoute,
  choiceItemsSaveRoute,
  choiceListCreateRoute,
  choiceListUpdateRoute,
  referenceRoute,
} from './reference-routes';
export { trainingBuildRoute, trainingRoute } from './training-routes';
export type { Profile } from './service';
