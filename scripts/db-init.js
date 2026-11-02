import 'dotenv/config';
import {openStorage} from '../storage.js';
const storage=openStorage();
try {storage.initialize();console.log('Database ready:',JSON.stringify(storage.stats()));}
finally {storage.close();}
