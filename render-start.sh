#!/bin/bash
# Apply database schema
npx drizzle-kit push

# Check if database is empty and seed if needed
# You can seed data manually from the Render dashboard or modify this script

# Start the application
npx next start -p $PORT
