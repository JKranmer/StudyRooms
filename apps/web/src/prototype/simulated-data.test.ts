import { describe, expect, it } from 'vitest';

import { SIMULATED_NOW_MS, SIMULATED_SESSIONS, SIMULATED_VOICE_EVENTS } from '@/prototype/simulated-data';
import { buildSimulatedDashboard } from '@/prototype/use-simulated-dashboard';

const UTC_ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/;
const SNOWFLAKE = /^[0-9]{17,20}$/;

describe('dados simulados', () => {
  it('guardam horários em UTC e nada depois do "agora" do protótipo', () => {
    for (const session of SIMULATED_SESSIONS) {
      expect(session.startedAt).toMatch(UTC_ISO);
      expect(session.endedAt).toMatch(UTC_ISO);
      expect(Date.parse(session.endedAt)).toBeGreaterThan(Date.parse(session.startedAt));
      expect(Date.parse(session.endedAt)).toBeLessThanOrEqual(SIMULATED_NOW_MS);
    }
  });

  it('seguem o formato de raw_voice_events, sem histórico de voz antes do bot', () => {
    const keys = new Set(SIMULATED_VOICE_EVENTS.map((event) => event.idempotencyKey));
    expect(keys.size).toBe(SIMULATED_VOICE_EVENTS.length);
    for (const event of SIMULATED_VOICE_EVENTS) {
      expect(event.occurredAt).toMatch(UTC_ISO);
      expect(event.occurredAt >= '2026-10-05').toBe(true);
      expect(event.discordUserId).toMatch(SNOWFLAKE);
      expect(event.guildId).toMatch(SNOWFLAKE);
      expect(Object.keys(event).toSorted()).toEqual(
        ['discordUserId', 'eventType', 'fromChannelId', 'guildId', 'idempotencyKey', 'occurredAt', 'recordedAt', 'toChannelId'],
      );
    }
  });

  it('são sempre os mesmos e mostram streak com hoje ainda pendente', () => {
    const first = buildSimulatedDashboard('semana');
    expect(buildSimulatedDashboard('semana')).toEqual(first);
    expect(first.streak.todayMinutes).toBe(10);
    expect(first.streak.current).toBeGreaterThanOrEqual(10);
    expect(first.totalMinutes).toBeGreaterThan(0);
  });
});
