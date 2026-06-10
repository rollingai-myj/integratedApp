-- =============================================================================
-- V032: plan_position_mapping —— 把 "根油调味" 改名为 "粮油调味"
--
-- 修字面错（"根"应为"粮"）。position_code=6 不变，仅改 position_name。
-- 子品类（调味副食/粮油/冲调品）不动。
-- =============================================================================

UPDATE plan_position_mapping
   SET position_name = '粮油调味',
       updated_at    = now()
 WHERE position_code = 6
   AND position_name = '根油调味';
