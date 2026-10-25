import test from "node:test";
import assert from "node:assert/strict";
import { normalizeQuiz, newRoom, advance, control, join, submitAnswer, board, publicState, MAX_PLAYERS } from "./game.mjs";
const draft = () => ({title:"Sunday Recall",lobbySeconds:90,questionSeconds:20,reviewed:true,questions:[
  {prompt:"What book was read?",choices:["Romans","Mark","Luke","Acts"],correctIndex:0,source:"service",reference:"Romans 8"},
  {prompt:"Who preached?",choices:["Pastor","Deacon","Choir","Guest"],correctIndex:0,source:"sermon"}
]});
const room = () => newRoom("123456", draft(), "hashed-host-secret", 1000);
test("requires human-reviewed valid questions", () => {
  assert.equal(normalizeQuiz(draft()).questions.length,2);
  assert.throws(()=>normalizeQuiz({...draft(),reviewed:false}),/review/);
  assert.throws(()=>normalizeQuiz({...draft(),lobbySeconds:0}),/Lobby/);
  assert.throws(()=>normalizeQuiz({...draft(),questions:[{prompt:"bad",choices:["x"],correctIndex:0}]}),/four choices/);
});
test("lobby automatically starts first question, and question deadline closes submissions", () => {
  const r=room();join(r,"player-hash","Grace",2000);
  assert.equal(advance(r,90_999),false);
  assert.equal(advance(r,91_000),true);
  assert.equal(r.phase,"question");assert.equal(r.index,0);
  submitAnswer(r,"1",0,0,92_000);
  assert.equal(r.answerCount,1);
  assert.throws(()=>submitAnswer(r,"1",1,0,93_000),/already/);
  assert.equal(advance(r,111_000),true);assert.equal(r.phase,"reveal");
  assert.throws(()=>submitAnswer(r,"1",0,0,111_001),/closed/);
});
test("does not leak correct answer until reveal or publish draft to clients", () => {
  const r=room();control(r,"start",2000);
  const before=JSON.stringify(publicState(r,2500));
  assert.equal(before.includes("correctIndex"),false);
  assert.equal(before.includes("hashed-host"),false);
  assert.equal(before.includes("sermon"),false); // inactive second question
  control(r,"reveal",3000);const after=publicState(r,3001);
  assert.equal(after.question.correctIndex,0);
});
test("correctness ranks above speed; speed resolves equal correct totals", () => {
  const r=room();join(r,"g","Grace",1001);join(r,"d","Daniel",1002);join(r,"s","Sarah",1003);
  control(r,"start",2000);
  submitAnswer(r,"1",0,0,2500);
  submitAnswer(r,"2",0,0,4500);
  submitAnswer(r,"3",1,0,2100);
  control(r,"reveal",5000);control(r,"next",5001);
  submitAnswer(r,"1",0,1,6000);
  submitAnswer(r,"2",0,1,7000);
  control(r,"reveal",8000);control(r,"next",8001);
  assert.deepEqual(board(r).map(x=>x.nickname),["Grace","Daniel","Sarah"]);
  assert.deepEqual(board(r).map(x=>x.points),[200,200,0]);
  assert.equal(publicState(r,8002).leaderboard[0].nickname,"Grace");
});
test("pause freezes lobby deadline until resume; extension adds 30 seconds", () => {
  const r=room();control(r,"extend",2000);assert.equal(r.deadline,121_000);
  control(r,"pause",4000);assert.equal(r.remainingMs,117_000);assert.equal(r.deadline,null);
  assert.equal(advance(r,50_000),false);control(r,"resume",50_000);
  assert.equal(r.deadline,167_000);
});
test("unapproved controls, players limit and bad nicknames are refused at domain layer", () => {
  const r=room();
  assert.throws(()=>join(r,"x","!",3000),/nickname/);
  assert.throws(()=>control(r,"next",3000),/not available/);
  assert.equal(MAX_PLAYERS,500);
});
