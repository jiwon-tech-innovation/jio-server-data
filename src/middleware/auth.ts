
import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

// 확장된 Request 타입 정의 (user 속성 추가)
declare global {
    namespace Express {
        interface Request {
            user?: {
                id: number | string;
                email: string;
                role?: string;
            };
        }
    }
}

<<<<<<< HEAD
const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // TODO: production에서는 반드시 환경변수 사용
=======
const JWT_SECRET_RAW = process.env.JWT_SECRET || 'your-secret-key';
// Spring Boot에서 64자 미만 시크릿은 'x'로 패딩하여 사용
const JWT_SECRET = JWT_SECRET_RAW.length < 64
    ? JWT_SECRET_RAW.padEnd(64, 'x')
    : JWT_SECRET_RAW;
>>>>>>> origin/mvp/v5.0.0

export const authMiddleware = (req: Request, res: Response, next: NextFunction) => {
    // 1. 헤더에서 토큰 추출
    const authHeader = req.headers.authorization;
    if (!authHeader) {
        res.status(401).json({ success: false, error: 'Unauthorized: No token provided' });
        return;
    }

    const token = authHeader.split(' ')[1]; // "Bearer <token>"
    if (!token) {
        res.status(401).json({ success: false, error: 'Unauthorized: Invalid token format' });
        return;
    }

    try {
<<<<<<< HEAD
        // 2. 토큰 검증
        const decoded = jwt.verify(token, JWT_SECRET) as any;
=======
        // 2. 토큰 검증 (HS256, HS384, HS512 모두 지원)
        // Spring Boot는 시크릿을 그대로 또는 Base64 인코딩하여 사용할 수 있음
        let decoded: any;
        try {
            // 먼저 시크릿을 그대로 사용해서 시도
            decoded = jwt.verify(token, JWT_SECRET, { algorithms: ['HS256', 'HS384', 'HS512'] });
        } catch (e) {
            // 실패하면 Base64 디코딩된 시크릿으로 재시도
            const base64Secret = Buffer.from(JWT_SECRET, 'base64');
            decoded = jwt.verify(token, base64Secret, { algorithms: ['HS256', 'HS384', 'HS512'] });
        }
>>>>>>> origin/mvp/v5.0.0

        // 3. 사용자 정보 req 객체에 저장
        req.user = {
            id: decoded.id || decoded.userId || decoded.sub, // 다양한 클레임 이름 대응
            email: decoded.email,
            role: decoded.role
        };

        next();
    } catch (error) {
        console.error('[Auth] Token verification failed:', error);
        res.status(403).json({ success: false, error: 'Forbidden: Invalid or expired token' });
        return;
    }
};
