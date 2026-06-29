import React, { useEffect, useState, useRef, useCallback } from 'react';
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts';
import { RefreshCw, Activity, Calendar, Sliders, Bot, Send } from 'lucide-react';

const Dashboard = () => {
  const [rawData, setRawData] = useState([]);
  const [sensors, setSensors] = useState([]);
  const [selectedSensor, setSelectedSensor] = useState('ALL');
  const [loading, setLoading] = useState(true);

  // 📆 Filtro único por día (seleccione el día a evaluar)
  const [selectedDay, setSelectedDay] = useState('2026-05-25');

  // ⚡ Estados para el Chat del Agente de IA
  const [messages, setMessages] = useState([]);
  const [chatInput, setChatInput] = useState("");
  const [chatLoading, setChatLoading] = useState(false);
  const chatEndRef = useRef(null);

  // 🔗 Endpoints Oficiales de AWS API Gateway (Rutas Públicas sin Autorizador)
  const API_URL_TELEMETRIA = "https://vwca36v4vl.execute-api.us-east-1.amazonaws.com/data";
  const API_URL_IA = "https://qbh9h5sr4j.execute-api.us-east-1.amazonaws.com/prod/McpAgentService";

  const sensorColors = [
    { stroke: "#68d391", fill: "#68d391", text: "#2f855a" },
    { stroke: "#63b3ed", fill: "#63b3ed", text: "#2c5282" },
    { stroke: "#f6ad55", fill: "#f6ad55", text: "#9c4221" },
    { stroke: "#b794f4", fill: "#b794f4", text: "#553c9a" },
    { stroke: "#f687b3", fill: "#f687b3", text: "#97266d" },
  ];

  // 📊 Consumir datos históricos de telemetría
  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const response = await fetch(API_URL_TELEMETRIA, {
        method: 'GET',
        headers: { 
          'Content-Type': 'application/json'
        }
      });
      
      if (response.status === 401 || response.status === 403) {
        console.error("❌ Error de Acceso: El servicio respondió con 401/403.");
        return;
      }

      const result = await response.json();
      const normalizedResult = (Array.isArray(result) ? result : []).map(item => ({
        ...item,
        id: item.sensor_id || item.id || "Desconocido"
      }));

      setRawData(normalizedResult);
      
      const uniqueSensors = [...new Set(normalizedResult.map(item => item.id))]
        .filter(id => id && typeof id === 'string')
        .sort();

      setSensors(uniqueSensors);
    } catch (error) {
      console.error("Error cargando datos de AWS:", error);
    } finally {
      setLoading(false);
    }
  }, [API_URL_TELEMETRIA]);

  // Sondeo Periódico (polling)
  useEffect(() => {
    fetchData();
    const interval = setInterval(fetchData, 30000); 
    return () => clearInterval(interval);
  }, [fetchData]);

  // Auto-scroll del chat
  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, chatLoading]);

  // (Removed legacy aggregation modes — charts now use per-metric hourly data)

  const getSensorStats = (sensorId) => {
    const sensorData = rawData
      .filter(d => d.id === sensorId)
      .sort((a, b) => a.timestamp - b.timestamp);

    if (sensorData.length === 0) return { data: [], min: 0, max: 0, avg: 0, current: 0, currentPres: 0 };
    // Normalizar temperaturas a números finitos antes de calcular estadísticas
    const temps = sensorData
      .map(d => Number(d.temperatura))
      .filter(t => Number.isFinite(t));

    const current = temps.length > 0 ? temps[temps.length - 1] : 0;
    const min = temps.length > 0 ? Math.min(...temps) : 0;
    const max = temps.length > 0 ? Math.max(...temps) : 0;
    const avg = temps.length > 0 ? parseFloat((temps.reduce((a, b) => a + b, 0) / temps.length).toFixed(1)) : 0;
    const currentPres = sensorData.length > 0 ? (sensorData[sensorData.length - 1].presion || 0) : 0;

    return { 
      data: sensorData.map(d => {
        const ts = d.timestamp * (d.timestamp < 1000000000000 ? 1000 : 1);
        return {
          time: isNaN(ts) ? "--:--" : new Date(ts).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          temp: d.temperatura || 0,
          presion: d.presion || 0,
          fullTime: isNaN(ts) ? "Fecha inválida" : new Date(ts).toLocaleString()
        };
      }), 
      min, max, avg, current, currentPres 
    };
  };

  // =========================================================================
  // 🤖 INTERACCIÓN CON EL AGENTE IA
  // =========================================================================
  const handleSendChatMessage = async () => {
    if (!chatInput.trim() || chatLoading) return;

    const userMsg = { sender: 'user', text: chatInput, timestamp: new Date().toLocaleTimeString() };
    setMessages(prev => [...prev, userMsg]);
    const payloadMessage = chatInput;
    setChatInput("");
    setChatLoading(true);

    try {
      const response = await fetch(API_URL_IA, {
        method: 'POST',
        headers: { 
          'Content-Type': 'application/json'
        },
        body: JSON.stringify({ message: payloadMessage })
      });
      
      if (response.status === 401 || response.status === 403) {
        setMessages(prev => [...prev, { 
          sender: 'agent', 
          text: "❌ Error de Acceso: El servicio devolvió 401/403.", 
          timestamp: new Date().toLocaleTimeString() 
        }]);
        return;
      }

      const data = await response.json();
      setMessages(prev => [...prev, { 
        sender: 'agent', 
        text: data.response || "⚠️ El Agente Procesó la consulta pero no devolvió datos estructurados.", 
        timestamp: new Date().toLocaleTimeString() 
      }]);
    } catch (error) {
      setMessages(prev => [...prev, { 
        sender: 'agent', 
        text: "❌ Error de enlace: No se pudo contactar con la pasarela del Agente AI.", 
        timestamp: new Date().toLocaleTimeString() 
      }]);
    } finally {
      setChatLoading(false);
    }
  };

  const visibleSensors = selectedSensor === 'ALL' ? sensors : [selectedSensor];

  // Devuelve datos horarios para la clave solicitada ('temperatura' | 'humedad' | 'presion')
  const getHourlyData = (key) => {
    let filtered = selectedSensor === 'ALL' ? rawData : rawData.filter(d => d.id === selectedSensor);
    return filtered
      .filter(item => {
        const dateObj = item.fecha_registro ? new Date(item.fecha_registro) : new Date(item.timestamp * (item.timestamp < 1000000000000 ? 1000 : 1));
        if (isNaN(dateObj.getTime())) return false;
        const dayLabel = dateObj.toISOString().split('T')[0];
        return dayLabel === selectedDay;
      })
      .map(item => {
        const dateObj = item.fecha_registro ? new Date(item.fecha_registro) : new Date(item.timestamp * (item.timestamp < 1000000000000 ? 1000 : 1));
        return {
          label: dateObj.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }),
          value: key === 'temperatura' ? item.temperatura : key === 'humedad' ? item.humedad : item.presion,
          rawTime: dateObj.getTime()
        };
      })
      .sort((a, b) => a.rawTime - b.rawTime);
  };

  const tempData = getHourlyData('temperatura');
  const humData = getHourlyData('humedad');
  const presData = getHourlyData('presion');

  return (
    <div style={{ padding: '20px', backgroundColor: '#f0f4f8', minHeight: '100vh', fontFamily: 'monospace' }}>
      
      {/* Encabezado del Sistema */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '20px', borderBottom: '2px solid #e2e8f0', paddingBottom: '10px', flexWrap: 'wrap', gap: '15px' }}>
        <div>
          <h2 style={{ color: '#1a365d', margin: 0, letterSpacing: '1px' }}>SISTEMA DE MONITOREO - SP26_CSE6011_Advanced Computer Structures</h2>
          <p style={{ margin: '5px 0 0 0', color: '#64748b', fontSize: '12px' }}>Análisis estadístico de variables microclimáticas (DHT22 + BMP280)</p>
        </div>
        
        <button 
          onClick={fetchData} 
          style={{ background: '#fff', border: '1px solid #cbd5e0', cursor: 'pointer', borderRadius: '4px', padding: '8px 12px', display: 'flex', alignItems: 'center', gap: '5px', fontWeight: 'bold' }}
        >
           <RefreshCw size={14} className={loading ? "animate-spin" : ""} />
           <span>{loading ? "Sincronizando..." : "Actualizar"}</span>
        </button>
      </div>

      {/* Barra Multifiltros de Control Analítico */}
      <div style={{ display: 'flex', gap: '15px', flexWrap: 'wrap', marginBottom: '25px', backgroundColor: '#fff', padding: '15px', borderRadius: '8px', border: '1px solid #e2e8f0', boxShadow: '0 2px 4px rgba(0,0,0,0.02)' }}>
        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', color: '#718096', fontWeight: 'bold' }}>📍 DISPOSITIVO ORIGEN</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e0', padding: '6px 10px', borderRadius: '4px' }}>
            <Sliders size={12} style={{ color: '#4a5568' }} />
            <select value={selectedSensor} onChange={(e) => setSelectedSensor(e.target.value)} style={{ border: 'none', outline: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', color: '#4a5568' }}>
              <option value="ALL">TODOS LOS NODOS COMBINADOS</option>
              {sensors.map(id => <option key={id} value={id}>NODO: {String(id).toUpperCase()}</option>)}
            </select>
          </div>
        </div>

        <div style={{ display: 'flex', flexDirection: 'column', gap: '5px' }}>
          <span style={{ fontSize: '10px', color: '#718096', fontWeight: 'bold' }}>📅 DIA A EVALUAR</span>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', border: '1px solid #cbd5e0', padding: '6px 10px', borderRadius: '4px' }}>
            <Calendar size={12} style={{ color: '#4a5568' }} />
            <input type="date" value={selectedDay} onChange={(e) => setSelectedDay(e.target.value)} style={{ border: 'none', outline: 'none', cursor: 'pointer', fontWeight: 'bold', fontSize: '12px', color: '#4a5568' }} />
          </div>
        </div>
      </div>

      {/* Bloque del Reporte Histórico (Tres gráficas independientes) */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '18px', marginBottom: '30px' }}>
        <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '14px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: '#1a365d', marginBottom: '12px', fontSize: '14px', borderBottom: '2px solid #3182ce', paddingBottom: '6px' }}>
            <Calendar size={16} /> REPORTE HORARIO: {selectedDay}
          </div>
          {(tempData.length === 0 && humData.length === 0 && presData.length === 0) ? (
            <div style={{ textAlign: 'center', padding: '30px', color: '#a0aec0', fontSize: '12px' }}>
              ⚠️ No se encontraron registros para el día seleccionado.
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr', gap: '12px' }}>
              {/* Temperatura */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #edf2f7', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontWeight: 'bold', color: '#2c5282', marginBottom: '6px' }}>Temperatura (°C)</div>
                <div style={{ height: '160px' }}>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={tempData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" fontSize={10} tick={{fill: '#718096'}} />
                      <YAxis fontSize={10} tick={{fill: '#718096'}} />
                      <Tooltip contentStyle={{borderRadius: '8px', border: 'none'}} formatter={(val) => [val, '°C']} />
                      <Area type="monotone" dataKey="value" stroke="#3182ce" fill="#90cdf4" fillOpacity={0.2} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Humedad */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #edf2f7', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontWeight: 'bold', color: '#2c7a7b', marginBottom: '6px' }}>Humedad (%)</div>
                <div style={{ height: '160px' }}>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={humData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" fontSize={10} tick={{fill: '#718096'}} />
                      <YAxis fontSize={10} tick={{fill: '#718096'}} />
                      <Tooltip contentStyle={{borderRadius: '8px', border: 'none'}} formatter={(val) => [val, '%']} />
                      <Area type="monotone" dataKey="value" stroke="#48bb78" fill="#a3e635" fillOpacity={0.15} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>

              {/* Presión */}
              <div style={{ backgroundColor: '#fff', border: '1px solid #edf2f7', borderRadius: '6px', padding: '10px' }}>
                <div style={{ fontWeight: 'bold', color: '#9c4221', marginBottom: '6px' }}>Presión (hPa)</div>
                <div style={{ height: '160px' }}>
                  <ResponsiveContainer width="100%" height={160}>
                    <AreaChart data={presData} margin={{ top: 8, right: 10, left: -10, bottom: 0 }}>
                      <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#f1f5f9" />
                      <XAxis dataKey="label" fontSize={10} tick={{fill: '#718096'}} />
                      <YAxis fontSize={10} tick={{fill: '#718096'}} />
                      <Tooltip contentStyle={{borderRadius: '8px', border: 'none'}} formatter={(val) => [val, 'hPa']} />
                      <Area type="monotone" dataKey="value" stroke="#ed8936" fill="#fbd38d" fillOpacity={0.12} />
                    </AreaChart>
                  </ResponsiveContainer>
                </div>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Contenedor del Chat del Agente IA */}
      <div style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', marginBottom: '30px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '8px', fontWeight: 'bold', color: '#1a365d', marginBottom: '15px', fontSize: '14px', borderBottom: '2px solid #4299e1', paddingBottom: '5px' }}>
          <Bot size={18} style={{ color: '#3182ce' }} /> AGENTE COGNITIVO — AWS AI SERVICE
        </div>
        
        <div style={{ height: '220px', overflowY: 'auto', padding: '15px', backgroundColor: '#f8fafc', borderRadius: '6px', border: '1px solid #edf2f7', marginBottom: '15px' }}>
          {messages.length === 0 ? (
            <div style={{ color: '#94a3b8', fontSize: '12px', textAlign: 'center', paddingTop: '40px' }}>
              🤖 ¡Hola, Diego! Pregúntame sobre las métricas analíticas o confort térmico del aula.
            </div>
          ) : (
            messages.map((msg, index) => (
              <div key={index} style={{ display: 'flex', justifyContent: msg.sender === 'user' ? 'flex-end' : 'flex-start', marginBottom: '12px' }}>
                <div style={{ 
                  backgroundColor: msg.sender === 'user' ? '#ebf8ff' : '#ffffff', 
                  color: '#2d3748',
                  padding: '10px 14px', 
                  borderRadius: '8px', 
                  border: '1px solid #e2e8f0', 
                  fontSize: '12px', 
                  maxWidth: '75%',
                  whiteSpace: 'pre-line',
                  boxShadow: '0 1px 2px rgba(0,0,0,0.02)'
                }}>
                  <div style={{ fontSize: '10px', color: '#a0aec0', marginBottom: '3px', fontWeight: 'bold' }}>
                    {msg.sender === 'user' ? `TÚ • ${msg.timestamp}` : `AGENTE AWS AI • ${msg.timestamp}`}
                  </div>
                  {msg.text}
                </div>
              </div>
            ))
          )}
          {chatLoading && (
            <div style={{ display: 'flex', alignItems: 'center', gap: '6px', fontSize: '11px', color: '#718096' }}>
              <span>🔄 Estructurando respuesta cognitiva desde AWS Lambda...</span>
            </div>
          )}
          <div ref={chatEndRef} />
        </div>

        <div style={{ display: 'flex', gap: '10px' }}>
          <input 
            type="text" 
            value={chatInput} 
            onChange={(e) => setChatInput(e.target.value)} 
            onKeyDown={(e) => e.key === 'Enter' && handleSendChatMessage()} 
            placeholder="Ej: ¿Cuáles son las condiciones actuales en el aula 22?" 
            style={{ flexGrow: 1, padding: '10px', borderRadius: '4px', border: '1px solid #cbd5e0', fontSize: '12px', fontFamily: 'monospace', outline: 'none' }} 
          />
          <button 
            onClick={handleSendChatMessage} 
            style={{ background: '#1a365d', color: '#fff', border: 'none', borderRadius: '4px', padding: '0 20px', cursor: 'pointer', fontSize: '12px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '6px' }}
          >
            <Send size={12} />
            <span>Consultar Agent</span>
          </button>
        </div>
      </div>

      {/* Monitoreo por Nodos en Tiempo Real */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(450px, 1fr))', gap: '25px' }}>
        {visibleSensors.map((sensorId, index) => {
          if (!sensorId) return null;
          const stats = getSensorStats(sensorId);
          const colorSet = sensorColors[index % sensorColors.length];
          
          return (
            <div key={sensorId} style={{ backgroundColor: 'white', border: '1px solid #e2e8f0', borderRadius: '8px', padding: '20px', boxShadow: '0 2px 4px rgba(0,0,0,0.05)' }}>
              <div style={{ textAlign: 'center', fontWeight: 'bold', color: '#4a5568', marginBottom: '15px', fontSize: '14px', borderBottom: `2px solid ${colorSet.stroke}`, paddingBottom: '5px' }}>
                DISPOSITIVO ACTIVO: <span style={{color: colorSet.text}}>{String(sensorId).toUpperCase()}</span>
              </div>
              
              <div style={{ height: '150px', width: '100%', minWidth: 0 }}>
                <ResponsiveContainer width="100%" height={150}>
                  <AreaChart data={stats.data} margin={{ top: 10, right: 10, left: -20, bottom: 0 }}>
                    <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="#edf2f7" />
                    <XAxis dataKey="time" fontSize={9} tick={{fill: '#718096'}} axisLine={false} />
                    <YAxis fontSize={9} tick={{fill: '#718096'}} axisLine={false} unit="°" />
                    <Tooltip labelFormatter={(value, payload) => (payload && payload.length > 0) ? payload[0].payload.fullTime : value} contentStyle={{borderRadius: '8px', border: 'none', boxShadow: '0 4px 12px rgba(0,0,0,0.1)'}} />
                    <Area type="monotone" dataKey="temp" stroke={colorSet.stroke} fill={colorSet.fill} fillOpacity={0.4} strokeWidth={2} />
                  </AreaChart>
                </ResponsiveContainer>
              </div>

              <table style={{ width: '100%', marginTop: '15px', fontSize: '12px', borderCollapse: 'collapse', color: '#2d3748', borderTop: '1px solid #edf2f7' }}>
                <thead>
                  <tr style={{ color: '#718096', height: '30px' }}>
                    <th align="left" style={{paddingLeft: '5px'}}><Activity size={12} /> Metric (DHT22)</th>
                    <th>min</th>
                    <th>max</th>
                    <th>avg</th>
                    <th style={{ color: '#3182ce' }}>Current Temp</th>
                    <th style={{ color: '#e53e3e' }}>Current Pres (BMP280)</th>
                  </tr>
                </thead>
                <tbody>
                  <tr align="center" style={{height: '35px', backgroundColor: '#f8fafc'}}>
                    <td align="left" style={{ color: colorSet.text, fontWeight: 'bold', paddingLeft: '5px' }}>— {sensorId}</td>
                    <td>{stats.min}°C</td>
                    <td>{stats.max}°C</td>
                    <td>{stats.avg}°C</td>
                    <td style={{ color: '#3182ce', fontWeight: 'bold', fontSize: '13px' }}>{stats.current}°C</td>
                    <td style={{ color: '#e53e3e', fontWeight: 'bold', fontSize: '13px' }}>{stats.currentPres} hPa</td>
                  </tr>
                </tbody>
              </table>
            </div>
          );
        })}
      </div>
      
      <div style={{marginTop: '30px', textAlign: 'center', color: '#94a3b8', fontSize: '11px'}}>
        Panel de Control Analítico IoT | Desplegado en AWS Amplify
      </div>
    </div>
  );
};

export default Dashboard;