// ===============================
// BARBIE SALON BOOKING MINI APP V1+
// Функції: запис, скасування, перенесення, зайняті слоти
// ===============================

const API_URL = 'https://script.google.com/macros/s/AKfycbycj40sY2YJiq0TndLiaC2P4ZxBC8B0WQq8zwJA_BTYhAk-XjfmqEySylnuiGZvEDaIXA/exec';

const DEFAULT_SETTINGS = { workStart:'10:00', workEnd:'16:00', slotStep:30, bookingDays:30, breakStart:'', breakEnd:'' };
const FALLBACK_SERVICES = [
  {id:'1', service_name:'Стрижка', duration:30, price:500, active:true},
  {id:'2', service_name:'Укладка', duration:60, price:700, active:true},
  {id:'3', service_name:'Фарбування', duration:120, price:1800, active:true},
  {id:'4', service_name:'Догляд', duration:60, price:900, active:true}
];

let state = {
  tg: window.Telegram?.WebApp || null,
  user:null,
  mode: getQueryParam('mode') || 'booking',
  token: getQueryParam('token') || '',
  booking:null,
  services:[], settings:DEFAULT_SETTINGS, blockedDates:[], busyRanges:[],
  selectedService:null, selectedDate:null, selectedTime:null, currentMonth:new Date()
};

const els = {
  heroTitle: document.getElementById('heroTitle'), heroText: document.getElementById('heroText'),
  cancelCard: document.getElementById('cancelCard'), cancelDetails: document.getElementById('cancelDetails'),
  confirmCancel: document.getElementById('confirmCancel'), keepBooking: document.getElementById('keepBooking'),
  services: document.getElementById('services'), calendar: document.getElementById('calendar'), monthTitle: document.getElementById('monthTitle'),
  prevMonth: document.getElementById('prevMonth'), nextMonth: document.getElementById('nextMonth'), slots: document.getElementById('slots'), timeHint: document.getElementById('timeHint'),
  form: document.getElementById('bookingForm'), summary: document.getElementById('summary'), submitBtn: document.getElementById('submitBtn'),
  successCard: document.getElementById('successCard'), successTitle: document.getElementById('successTitle'), successDetails: document.getElementById('successDetails'),
  errorBox: document.getElementById('errorBox'), backToBot: document.getElementById('backToBot'), newBooking: document.getElementById('newBooking'),
  steps:{service:document.getElementById('step-service'), date:document.getElementById('step-date'), time:document.getElementById('step-time'), form:document.getElementById('step-form')}
};

init();

async function init(){
  if(state.tg){ state.tg.ready(); state.tg.expand(); state.user = state.tg.initDataUnsafe?.user || null; }
  bindEvents();
  await loadInitialData();

  if(state.mode === 'cancel') return initCancelMode();
  if(state.mode === 'reschedule') return initRescheduleMode();

  renderServices(); renderCalendar();
}

function bindEvents(){
  els.prevMonth.addEventListener('click',()=>changeMonth(-1));
  els.nextMonth.addEventListener('click',()=>changeMonth(1));
  els.form.addEventListener('submit',submitBooking);
  els.backToBot.addEventListener('click',()=> state.tg ? state.tg.close() : null);
  els.newBooking.addEventListener('click',()=> window.location.href = window.location.origin + window.location.pathname);
  els.keepBooking.addEventListener('click',()=> state.tg ? state.tg.close() : showSuccessMessage('Запис залишено без змін','Можеш закрити це вікно.'));
  els.confirmCancel.addEventListener('click',confirmCancelBooking);
}

async function loadInitialData(){
  try{
    if(!isApiReady()) throw new Error('API_URL не налаштований');
    const data = await apiGet('getInitialData');
    state.services = normalizeServices(data.services || []);
    state.settings = {...DEFAULT_SETTINGS, ...(data.settings || {})};
    state.blockedDates = data.blocked_dates || [];
  }catch(err){
    state.services = FALLBACK_SERVICES; state.settings = DEFAULT_SETTINGS; state.blockedDates = [];
    showError('Демо-режим: backend ще не підключений. Реальний запис у таблицю не збережеться.');
  }
}

async function initCancelMode(){
  hideAllSteps(); els.cancelCard.classList.remove('hidden');
  els.heroTitle.textContent = 'Скасування запису';
  els.heroText.textContent = 'Підтвердь скасування, щоб майстер одразу отримав повідомлення.';
  try{
    const data = await apiGet('getBookingByToken',{token:state.token});
    if(!data.success) throw new Error(data.message || 'Запис не знайдено');
    state.booking = data.booking;
    els.cancelDetails.innerHTML = bookingHtml(state.booking);
  }catch(err){ showError(err.message); }
}

async function initRescheduleMode(){
  els.heroTitle.textContent = 'Перенесення запису';
  els.heroText.textContent = 'Обери новий день і час. Послуга підтягнеться автоматично.';
  try{
    const data = await apiGet('getBookingByToken',{token:state.token});
    if(!data.success) throw new Error(data.message || 'Запис не знайдено');
    state.booking = data.booking;
    const service = state.services.find(s => String(s.id) === String(state.booking.service_id)) || {
      id: state.booking.service_id, service_name: state.booking.service, duration:Number(state.booking.duration), price: state.booking.price, active:true
    };
    state.selectedService = service;
    document.getElementById('clientName').value = state.booking.name || '';
    document.getElementById('clientPhone').value = state.booking.phone || '';
    document.getElementById('clientComment').value = state.booking.comment || '';
    els.submitBtn.textContent = 'Підтвердити перенесення 💗';
    openStep('date'); renderCalendar(); renderSlots(); updateSummary();
  }catch(err){ showError(err.message); }
}

function normalizeServices(services){ return services.filter(s=>String(s.active).toLowerCase()==='true'||s.active===true).map(s=>({...s,duration:Number(s.duration||30),price:Number(s.price||0)})); }
function renderServices(){ els.services.innerHTML=''; state.services.forEach(service=>{ const btn=document.createElement('button'); btn.type='button'; btn.className='service-btn'; btn.innerHTML=`<strong>${escapeHtml(service.service_name)}</strong><span>${service.duration} хв · ${service.price?service.price+' грн':'ціну уточнить майстер'}</span>`; btn.addEventListener('click',()=>selectService(service,btn)); els.services.appendChild(btn); }); }
function selectService(service,btn){ state.selectedService=service; state.selectedDate=null; state.selectedTime=null; document.querySelectorAll('.service-btn').forEach(b=>b.classList.remove('selected')); btn.classList.add('selected'); openStep('date'); renderCalendar(); renderSlots(); updateSummary(); }
function changeMonth(delta){ const next=new Date(state.currentMonth); next.setMonth(next.getMonth()+delta); state.currentMonth=next; renderCalendar(); }

function renderCalendar(){
  const year=state.currentMonth.getFullYear(), month=state.currentMonth.getMonth();
  const today=startOfDay(new Date()), maxDate=addDays(today,Number(state.settings.bookingDays||30));
  els.monthTitle.textContent=state.currentMonth.toLocaleDateString('uk-UA',{month:'long',year:'numeric'}); els.calendar.innerHTML='';
  const firstDay=new Date(year,month,1), lastDay=new Date(year,month+1,0), mondayIndex=(firstDay.getDay()+6)%7;
  for(let i=0;i<mondayIndex;i++){ const empty=document.createElement('button'); empty.className='day-btn day-empty'; empty.disabled=true; els.calendar.appendChild(empty); }
  for(let day=1;day<=lastDay.getDate();day++){
    const date=new Date(year,month,day), iso=toIsoDate(date);
    const btn=document.createElement('button'); btn.type='button'; btn.className='day-btn'; btn.textContent=day;
    btn.disabled=startOfDay(date)<today || startOfDay(date)>maxDate || state.blockedDates.includes(iso) || !state.selectedService;
    if(state.selectedDate===iso) btn.classList.add('selected'); btn.addEventListener('click',()=>selectDate(iso)); els.calendar.appendChild(btn);
  }
}
async function selectDate(isoDate){ state.selectedDate=isoDate; state.selectedTime=null; renderCalendar(); openStep('time'); await loadBusyRanges(); renderSlots(); updateSummary(); }
async function loadBusyRanges(){ state.busyRanges=[]; try{ if(!isApiReady()) return; const data=await apiGet('getBusyRanges',{date:state.selectedDate, ignore_id: state.booking?.id || ''}); state.busyRanges=data.busy_ranges||[]; }catch(err){ showError('Не вдалося завантажити зайняті слоти. Перевір Apps Script URL.'); } }
function renderSlots(){
  els.slots.innerHTML=''; if(!state.selectedService||!state.selectedDate){ els.timeHint.textContent='Спочатку обери послугу і дату.'; return; }
  const slots=generateSlots(state.settings.workStart,state.settings.workEnd,Number(state.settings.slotStep||30),Number(state.selectedService.duration||30),state.settings.breakStart,state.settings.breakEnd);
  els.timeHint.textContent=slots.length?'Доступні вікна для цієї послуги:':'На цей день немає доступного часу.';
  slots.forEach(time=>{ const btn=document.createElement('button'); btn.type='button'; btn.className='slot-btn'; btn.textContent=time; const endTime=addMinutesToTime(time,state.selectedService.duration); btn.disabled=overlapsBusy(time,endTime,state.busyRanges); if(state.selectedTime===time) btn.classList.add('selected'); btn.addEventListener('click',()=>selectTime(time)); els.slots.appendChild(btn); });
}
function selectTime(time){ state.selectedTime=time; document.querySelectorAll('.slot-btn').forEach(btn=>btn.classList.remove('selected')); [...els.slots.children].find(btn=>btn.textContent===time)?.classList.add('selected'); openStep('form'); updateSummary(); }
function generateSlots(workStart,workEnd,step,duration,breakStart,breakEnd){ const result=[],start=timeToMinutes(workStart),end=timeToMinutes(workEnd),bStart=breakStart?timeToMinutes(breakStart):null,bEnd=breakEnd?timeToMinutes(breakEnd):null; for(let current=start;current+duration<=end;current+=step){ const slotEnd=current+duration, crossesBreak=bStart!==null&&bEnd!==null&&current<bEnd&&slotEnd>bStart; if(!crossesBreak) result.push(minutesToTime(current)); } return result; }
function overlapsBusy(startTime,endTime,busyRanges){ const start=timeToMinutes(startTime),end=timeToMinutes(endTime); return busyRanges.some(range=>start<timeToMinutes(range.end_time)&&end>timeToMinutes(range.start_time)); }
function updateSummary(){ if(!state.selectedService||!state.selectedDate||!state.selectedTime){ els.summary.classList.remove('visible'); return; } const endTime=addMinutesToTime(state.selectedTime,state.selectedService.duration); els.summary.classList.add('visible'); els.summary.innerHTML=`<strong>${state.mode==='reschedule'?'Новий час запису':'Твій запис'}:</strong><br>Послуга: ${escapeHtml(state.selectedService.service_name)}<br>Дата: ${formatDate(state.selectedDate)}<br>Час: ${state.selectedTime}–${endTime}`; }

async function submitBooking(event){
  event.preventDefault(); hideError();
  if(!state.selectedService||!state.selectedDate||!state.selectedTime) return showError('Обери послугу, дату і час.');
  const payload={ telegram_id:state.user?.id||getQueryParam('telegram_id')||state.booking?.telegram_id||'demo_user', username:state.user?.username||'', name:document.getElementById('clientName').value.trim(), phone:document.getElementById('clientPhone').value.trim(), service_id:state.selectedService.id, service:state.selectedService.service_name, duration:Number(state.selectedService.duration), price:Number(state.selectedService.price||0), date:state.selectedDate, time:state.selectedTime, end_time:addMinutesToTime(state.selectedTime,state.selectedService.duration), comment:document.getElementById('clientComment').value.trim() };
  if(!payload.name||!payload.phone) return showError('Заповни ім’я і телефон.');
  els.submitBtn.disabled=true; els.submitBtn.textContent=state.mode==='reschedule'?'Переношу...':'Записую...';
  try{
    if(!isApiReady()) throw new Error('API_URL не налаштований');
    const response = state.mode==='reschedule' ? await apiPost('rescheduleBooking',{token:state.token,...payload}) : await apiPost('createBooking',payload);
    if(!response.success) throw new Error(response.message||'Не вдалося створити запис');
    showSuccess({...payload,id:response.id}, state.mode==='reschedule');
  }catch(err){ showError(err.message||'Помилка запису. Спробуй ще раз.'); }
  finally{ els.submitBtn.disabled=false; els.submitBtn.textContent=state.mode==='reschedule'?'Підтвердити перенесення 💗':'Підтвердити запис 💗'; }
}
async function confirmCancelBooking(){
  hideError(); els.confirmCancel.disabled=true; els.confirmCancel.textContent='Скасовую...';
  try{ const response=await apiPost('cancelBooking',{token:state.token}); if(!response.success) throw new Error(response.message||'Не вдалося скасувати'); showSuccessMessage('Запис скасовано','Майстер отримав повідомлення. Це вікно можна закрити.'); }
  catch(err){ showError(err.message); }
  finally{ els.confirmCancel.disabled=false; els.confirmCancel.textContent='Так, скасувати запис'; }
}
function showSuccess(payload,isReschedule=false){ hideAllSteps(); els.cancelCard.classList.add('hidden'); els.successCard.classList.remove('hidden'); els.successTitle.textContent=isReschedule?'Запис перенесено':'Твій запис підтверджено'; els.successDetails.innerHTML=`<strong>Послуга:</strong> ${escapeHtml(payload.service)}<br><strong>Дата:</strong> ${formatDate(payload.date)}<br><strong>Час:</strong> ${payload.time}–${payload.end_time}<br><strong>Ім’я:</strong> ${escapeHtml(payload.name)}<br><strong>Телефон:</strong> ${escapeHtml(payload.phone)}`; if(state.tg) state.tg.sendData(JSON.stringify({action:isReschedule?'booking_rescheduled':'booking_created',...payload})); }
function showSuccessMessage(title,text){ hideAllSteps(); els.cancelCard.classList.add('hidden'); els.successCard.classList.remove('hidden'); els.successTitle.textContent=title; els.successDetails.textContent=text; }
function openStep(stepName){ const order=['service','date','time','form']; const index=order.indexOf(stepName); order.forEach((name,i)=>els.steps[name].classList.toggle('active',i<=index)); setTimeout(()=>els.steps[stepName]?.scrollIntoView({behavior:'smooth',block:'start'}),80); }
function hideAllSteps(){ Object.values(els.steps).forEach(step=>step.classList.remove('active')); }
function bookingHtml(b){ return `<strong>Послуга:</strong> ${escapeHtml(b.service)}<br><strong>Дата:</strong> ${formatDate(b.date)}<br><strong>Час:</strong> ${b.time}–${b.end_time}<br><strong>Ім’я:</strong> ${escapeHtml(b.name)}`; }
async function apiGet(action,params={}){ const url=new URL(API_URL); url.searchParams.set('action',action); Object.entries(params).forEach(([k,v])=>url.searchParams.set(k,v)); const r=await fetch(url.toString()); return r.json(); }
async function apiPost(action,payload){ const r=await fetch(API_URL,{method:'POST',headers:{'Content-Type':'text/plain;charset=utf-8'},body:JSON.stringify({action,...payload})}); return r.json(); }
function isApiReady(){ return API_URL && !API_URL.includes('PASTE_YOUR'); }
function timeToMinutes(time){ const [h,m]=String(time).split(':').map(Number); return h*60+m; }
function minutesToTime(total){ const h=Math.floor(total/60),m=total%60; return `${String(h).padStart(2,'0')}:${String(m).padStart(2,'0')}`; }
function addMinutesToTime(time,minutes){ return minutesToTime(timeToMinutes(time)+Number(minutes)); }
function toIsoDate(date){ return `${date.getFullYear()}-${String(date.getMonth()+1).padStart(2,'0')}-${String(date.getDate()).padStart(2,'0')}`; }
function startOfDay(date){ return new Date(date.getFullYear(),date.getMonth(),date.getDate()); }
function addDays(date,days){ const next=new Date(date); next.setDate(next.getDate()+days); return next; }
function formatDate(iso){ return new Date(`${iso}T12:00:00`).toLocaleDateString('uk-UA',{day:'numeric',month:'long',year:'numeric'}); }
function getQueryParam(name){ return new URLSearchParams(window.location.search).get(name); }
function escapeHtml(value){ return String(value||'').replace(/[&<>'"]/g,tag=>({'&':'&amp;','<':'&lt;','>':'&gt;',"'":'&#39;','"':'&quot;'}[tag])); }
function showError(message){ els.errorBox.textContent=message; els.errorBox.classList.remove('hidden'); }
function hideError(){ els.errorBox.classList.add('hidden'); els.errorBox.textContent=''; }
