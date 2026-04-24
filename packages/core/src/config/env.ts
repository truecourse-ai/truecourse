import dotenv from 'dotenv';
import path from 'node:path';
import os from 'node:os';

// Load from ~/.truecourse/.env (packaged mode), then project root .env (dev mode)
dotenv.config({ path: path.join(os.homedir(), '.truecourse', '.env') });
dotenv.config({ path: '../../.env' });
