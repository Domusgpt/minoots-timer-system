import 'express-serve-static-core';
import { AuthContext } from './auth';

declare module 'express-serve-static-core' {
  interface Request {
    authContext?: AuthContext;
  }
}
