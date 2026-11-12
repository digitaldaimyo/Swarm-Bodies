CREATE TABLE "accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"token_hash" text NOT NULL,
	"name" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "accounts_token_hash_unique" UNIQUE("token_hash")
);
--> statement-breakpoint
CREATE TABLE "game_players" (
	"game_id" uuid NOT NULL,
	"seat" integer NOT NULL,
	"account_id" uuid NOT NULL,
	"strain" text NOT NULL,
	"bot_controlled" boolean DEFAULT false NOT NULL,
	"missed_turns" integer DEFAULT 0 NOT NULL,
	CONSTRAINT "game_players_game_id_seat_pk" PRIMARY KEY("game_id","seat")
);
--> statement-breakpoint
CREATE TABLE "game_snapshots" (
	"game_id" uuid NOT NULL,
	"turn" integer NOT NULL,
	"state" jsonb NOT NULL,
	CONSTRAINT "game_snapshots_game_id_turn_pk" PRIMARY KEY("game_id","turn")
);
--> statement-breakpoint
CREATE TABLE "games" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"code" text NOT NULL,
	"settings" jsonb NOT NULL,
	"seed" text NOT NULL,
	"status" text DEFAULT 'lobby' NOT NULL,
	"turn" integer DEFAULT 1 NOT NULL,
	"deadline" timestamp with time zone,
	"host_account" uuid NOT NULL,
	"result" jsonb,
	"reminder_sent_turn" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "games_code_unique" UNIQUE("code")
);
--> statement-breakpoint
CREATE TABLE "push_subscriptions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"account_id" uuid NOT NULL,
	"endpoint" text NOT NULL,
	"p256dh" text NOT NULL,
	"auth" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "push_subscriptions_endpoint_unique" UNIQUE("endpoint")
);
--> statement-breakpoint
CREATE TABLE "turn_orders" (
	"game_id" uuid NOT NULL,
	"turn" integer NOT NULL,
	"seat" integer NOT NULL,
	"orders" jsonb NOT NULL,
	"submitted_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_orders_game_id_turn_seat_pk" PRIMARY KEY("game_id","turn","seat")
);
--> statement-breakpoint
CREATE TABLE "turn_results" (
	"game_id" uuid NOT NULL,
	"turn" integer NOT NULL,
	"orders" jsonb NOT NULL,
	"state_hash" text NOT NULL,
	"resolved_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "turn_results_game_id_turn_pk" PRIMARY KEY("game_id","turn")
);
--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_players" ADD CONSTRAINT "game_players_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "game_snapshots" ADD CONSTRAINT "game_snapshots_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "games" ADD CONSTRAINT "games_host_account_accounts_id_fk" FOREIGN KEY ("host_account") REFERENCES "public"."accounts"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "push_subscriptions" ADD CONSTRAINT "push_subscriptions_account_id_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_orders" ADD CONSTRAINT "turn_orders_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "turn_results" ADD CONSTRAINT "turn_results_game_id_games_id_fk" FOREIGN KEY ("game_id") REFERENCES "public"."games"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "game_players_account" ON "game_players" USING btree ("game_id","account_id");