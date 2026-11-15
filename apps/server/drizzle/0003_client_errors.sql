CREATE TABLE "client_errors" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"message" text NOT NULL,
	"stack" text,
	"build" text NOT NULL,
	"screen" text NOT NULL,
	"device" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
