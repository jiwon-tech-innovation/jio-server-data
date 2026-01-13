
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

const JWT_SECRET = process.env.JWT_SECRET || 'your-secret-key'; // TODO: production에서는 반드시 환경변수 사용

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
        // 2. 토큰 검증
        const decoded = jwt.verify(token, JWT_SECRET) as any;

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
