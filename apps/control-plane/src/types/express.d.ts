import 'express-serve-static-core';
import { AuthContext } from '../policy/types';

declare module 'express-serve-static-core' {
  interface Request {
    authContext?: AuthContext;
  }
}
