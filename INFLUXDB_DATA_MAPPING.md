# InfluxDB 데이터 매핑 및 통계 조회 현황

## InfluxDB에 저장되는 데이터 (ingestion-service.ts)

### Tags
- `user_id`: 사용자 ID
- `category`: 활동 카테고리 (STUDY, PLAY, SLEEP, NEUTRAL)

### Fields
1. **score** (float): 집중도 점수 (0-100)
2. **state** (string): 상태 (NORMAL, FOCUSING, DISTRACTED, SLEEPING, AFK, EMERGENCY, GAMING)
3. **mouse_distance** (int): 마우스 이동 거리
4. **keystroke_count** (int): 키 입력 횟수
5. **click_count** (int): 클릭 횟수
6. **action_detail** (string): 창 제목 또는 상태
7. **entropy** (float, optional): 키보드 엔트로피
8. **focus_time_sec** (float, optional): 집중 시간 (초)
9. **sleep_time_sec** (float, optional): 졸음 시간 (초)
10. **away_time_sec** (float, optional): 자리 비움 시간 (초)
11. **distraction_time_sec** (float, optional): 딴짓 시간 (초)

## 통계 서비스에서 조회하는 데이터 (statistics-service.ts)

### ✅ 조회 중인 데이터

1. **concentrationScore**
   - 필드: `score`
   - 집계: 일별 평균
   - 상태: ✅ 조회 중

2. **focusTime**
   - 필드: `focus_time_sec`
   - 집계: 일별 합계 (초 → 분 변환)
   - 상태: ✅ 조회 중

3. **sleepTime**
   - 필드: `sleep_time_sec`
   - 집계: 일별 합계 (초 → 분 변환)
   - 상태: ✅ 조회 중

4. **awayTime**
   - 필드: `away_time_sec`
   - 집계: 일별 합계 (초 → 분 변환)
   - 상태: ✅ 조회 중

5. **distractionTime**
   - 필드: `distraction_time_sec`
   - 집계: 일별 합계 (초 → 분 변환)
   - 상태: ✅ 조회 중

6. **gameCount**
   - 필드: `category` tag
   - 조건: `category == "PLAY"`
   - 집계: 일별 카운트
   - 상태: ✅ 조회 중

7. **drowsyCount**
   - 필드: `sleep_time_sec`
   - 조건: `sleep_time_sec > 0`
   - 집계: 일별 레코드 카운트
   - 상태: ✅ 조회 중 (최근 수정됨)

8. **gazeOffCount**
   - 필드: `state`
   - 조건: `state == "DISTRACTED"`
   - 집계: 일별 레코드 카운트
   - 상태: ✅ 조회 중

9. **phoneDetections**
   - 필드: `action_detail`
   - 조건: phone 관련 키워드 포함
   - 집계: 일별 레코드 카운트
   - 상태: ✅ 조회 중

## 데이터 흐름

```
Kafka Message → Ingestion Service → InfluxDB
                                      ↓
                              Statistics Service
                                      ↓
                              API Response (JSON)
```

## 확인 사항

### 1. 데이터가 실제로 저장되고 있는지 확인
```bash
# InfluxDB 쿼리 예시
from(bucket: "sensor_data")
  |> range(start: -7d)
  |> filter(fn: (r) => r["_measurement"] == "user_activity")
  |> filter(fn: (r) => r["user_id"] == "your_user_id")
  |> limit(n: 10)
```

### 2. 통계 API 로그 확인
서버 로그에서 다음 메시지 확인:
- `[Statistics] State query completed. Processed X records.`
- `[Statistics] Sleep time query completed. Found X sleep records.`
- `[Statistics] Action detail query completed. Processed X records, found X phone detections.`

### 3. 누락된 데이터가 있는지 확인
- 모든 필드가 optional이므로, 메타데이터에서 값이 전달되지 않으면 저장되지 않음
- 특히 `focus_time_sec`, `sleep_time_sec` 등은 webcam.py에서 전달되어야 함

## 문제 해결

### 데이터가 0으로 표시되는 경우:
1. InfluxDB에 실제 데이터가 있는지 확인
2. user_id가 올바른지 확인
3. 날짜 범위가 올바른지 확인
4. 메타데이터에서 시간 필드가 전달되는지 확인

### 특정 통계가 안 뜨는 경우:
1. 해당 필드가 InfluxDB에 저장되는지 확인
2. 쿼리 조건이 올바른지 확인
3. 서버 로그에서 에러 확인
