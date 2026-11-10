export { createDb, type Database, type DbHandle, type DbOptions, type PoolOptions } from "./client.ts";
export { findErrorCode, isRejectedRowCode } from "./errors.ts";
export { migrationsFolder, runMigrations } from "./migrate.ts";
export { INSERT_CHUNK_SIZE, insertRawVoiceEvents } from "./raw-voice-events.ts";
export {
  botEventTypes,
  rawVoiceEvents,
  rawVoiceEventTypes,
  userVoiceEventTypes,
  type NewRawVoiceEvent,
  type RawVoiceEvent,
  type RawVoiceEventType,
} from "./schema.ts";
export {
  BACKUP_ROLE,
  BOT_ROLE,
  checkAccess,
  countUserEvents,
  forgetUser,
  generatePassword,
  pingDatabase,
  roleUrl,
  rolesSqlSteps,
  scramVerifier,
  setupRoles,
  type AccessCheck,
  type PasswordFormat,
  type PingResult,
  type RoleSetupResult,
  type RolesSqlStep,
  type SetupRolesOptions,
} from "./roles.ts";
export { RoleSetupError, safeServerMessage } from "./role-errors.ts";
