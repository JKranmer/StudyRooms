CREATE TABLE "raw_voice_events" (
	"id" bigint PRIMARY KEY GENERATED ALWAYS AS IDENTITY (sequence name "raw_voice_events_id_seq" INCREMENT BY 1 MINVALUE 1 MAXVALUE 9223372036854775807 START WITH 1 CACHE 1),
	"idempotency_key" uuid NOT NULL,
	"event_type" text NOT NULL,
	"discord_user_id" text,
	"guild_id" text,
	"from_channel_id" text,
	"to_channel_id" text,
	"occurred_at" timestamp with time zone NOT NULL,
	"recorded_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "raw_voice_events_idempotency_key_unique" UNIQUE("idempotency_key"),
	CONSTRAINT "raw_voice_events_event_type_check" CHECK (event_type in ('voice_join', 'voice_leave', 'voice_move', 'voice_present', 'bot_start', 'bot_disconnect', 'bot_resume', 'bot_heartbeat', 'bot_stop')),
	CONSTRAINT "raw_voice_events_snowflakes_check" CHECK ("raw_voice_events"."discord_user_id" ~ '^[0-9]{17,20}$'
        and "raw_voice_events"."guild_id" ~ '^[0-9]{17,20}$'
        and "raw_voice_events"."from_channel_id" ~ '^[0-9]{17,20}$'
        and "raw_voice_events"."to_channel_id" ~ '^[0-9]{17,20}$'),
	CONSTRAINT "raw_voice_events_shape_check" CHECK (case
        when "raw_voice_events"."event_type" in ('voice_join', 'voice_present') then
          "raw_voice_events"."discord_user_id" is not null and "raw_voice_events"."guild_id" is not null
          and "raw_voice_events"."from_channel_id" is null and "raw_voice_events"."to_channel_id" is not null
        when "raw_voice_events"."event_type" = 'voice_leave' then
          "raw_voice_events"."discord_user_id" is not null and "raw_voice_events"."guild_id" is not null
          and "raw_voice_events"."from_channel_id" is not null and "raw_voice_events"."to_channel_id" is null
        when "raw_voice_events"."event_type" = 'voice_move' then
          "raw_voice_events"."discord_user_id" is not null and "raw_voice_events"."guild_id" is not null
          and "raw_voice_events"."from_channel_id" is not null and "raw_voice_events"."to_channel_id" is not null
          and "raw_voice_events"."from_channel_id" <> "raw_voice_events"."to_channel_id"
        else
          "raw_voice_events"."discord_user_id" is null and "raw_voice_events"."from_channel_id" is null and "raw_voice_events"."to_channel_id" is null
      end)
);
--> statement-breakpoint
CREATE INDEX "raw_voice_events_user_occurred_idx" ON "raw_voice_events" USING btree ("discord_user_id","occurred_at");