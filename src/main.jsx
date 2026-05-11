import React, { useMemo, useRef, useState } from 'react';
import { createRoot } from 'react-dom/client';
import { Download, FileText, ImagePlus, LayoutTemplate, Plus, Trash2 } from 'lucide-react';
import './styles.css';

const COLOR_LIBRARY = [
  { name: 'BEGE DUNAS', hex: '#c8b89a' },
  { name: 'CARVALHO JARI', hex: '#a0784a' },
  { name: 'BRANCO SNOW', hex: '#f5f3ef' },
  { name: 'CINZA SAGRADO', hex: '#8a8a8a' },
  { name: 'GRAFITE', hex: '#4a4a4a' },
  { name: 'OFF WHITE', hex: '#f0ede6' },
  { name: 'MACADAMIA', hex: '#c4a882' },
  { name: 'PRETO PIANO', hex: '#1a1a1a' },
  { name: 'NOGUEIRA', hex: '#6b4c32' },
  { name: 'AREIA', hex: '#d4c4a8' },
];

const OPTION_SETS = {
  tamponamentos: ['15mm', '25mm', '15mm e 25mm', '6mm', '15mm e 6mm'],
  portas: ['LISA', 'CAVA 45°', 'PASSANTE', 'FRISO', 'ROMEU E JULIETA', 'AMERICANA', 'ESPELHO'],
  puxadores: ['CAVA 45°', 'GARD 256mm', 'PASSANTE', 'LISA PASSANTE', 'EMBUTIDO', 'PUXADOR J', 'PUXADOR L'],
  observacoes: [
    'Apenas Marcenaria considerado no ambiente',
    'Apenas Marcenaria e serralheria considerados no ambiente',
    'Leds nao inclusos',
    'Considerar cavas para instalacao de LEDS',
    'Eletrodomesticos nao inclusos',
  ],
};

const starterDocument = {
  clientName: 'KR PAVIMENTACOES LTDA',
  contractNumber: '100001678-2',
  factory: 'BOA VISTA / VITTA',
  address: 'Estrada dos Indios, 2645 - CASA 155 - Chacaras Copaco - ARUJA',
  projectCode: '2251',
  date: new Date().toLocaleDateString('pt-BR'),
  environments: [
    {
      id: crypto.randomUUID(),
      name: 'ESCRITORIO',
      subtitle: 'Projeto Inicial',
      image: '',
      colors: ['BEGE DUNAS', 'CARVALHO JARI'],
      tamponamentos: '15mm e 25mm',
      portas: 'LISA',
      puxadores: 'CAVA 45°',
      notes: ['Apenas Marcenaria e serralheria considerados no ambiente'],
      freeNote: 'Duas gavetas. Serralheria considerado no projeto.',
    },
    {
      id: crypto.randomUUID(),
      name: 'ENTRADA ESCRITORIO + P. LAVABO',
      subtitle: 'Projeto Inicial',
      image: '',
      colors: ['CARVALHO JARI'],
      tamponamentos: '15mm e 25mm',
      portas: 'LISA',
      puxadores: 'CAVA 45°',
      notes: ['Apenas Marcenaria considerado no ambiente'],
      freeNote: 'Porta mimetizada para lavabo. Paineis em volta da porta de entrada.',
    },
  ],
};

function updateById(items, id, patch) {
  return items.map((item) => (item.id === id ? { ...item, ...patch } : item));
}

function App() {
  const [documentData, setDocumentData] = useState(starterDocument);
  const [selectedId, setSelectedId] = useState(starterDocument.environments[0].id);
  const [isExporting, setIsExporting] = useState(false);
  const pdfRef = useRef(null);

  const selectedEnvironment = useMemo(
    () => documentData.environments.find((environment) => environment.id === selectedId) ?? documentData.environments[0],
    [documentData.environments, selectedId],
  );

  const updateDocument = (field, value) => {
    setDocumentData((current) => ({ ...current, [field]: value }));
  };

  const updateEnvironment = (id, patch) => {
    setDocumentData((current) => ({
      ...current,
      environments: updateById(current.environments, id, patch),
    }));
  };

  const addEnvironment = () => {
    const nextEnvironment = {
      id: crypto.randomUUID(),
      name: 'NOVO AMBIENTE',
      subtitle: 'Projeto Inicial',
      image: '',
      colors: [],
      tamponamentos: '',
      portas: '',
      puxadores: '',
      notes: [],
      freeNote: '',
    };

    setDocumentData((current) => ({
      ...current,
      environments: [...current.environments, nextEnvironment],
    }));
    setSelectedId(nextEnvironment.id);
  };

  const removeEnvironment = (id) => {
    setDocumentData((current) => {
      if (current.environments.length === 1) return current;
      const next = current.environments.filter((environment) => environment.id !== id);
      if (selectedId === id) setSelectedId(next[0].id);
      return { ...current, environments: next };
    });
  };

  const handleImage = (environmentId, file) => {
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => updateEnvironment(environmentId, { image: reader.result });
    reader.readAsDataURL(file);
  };

  const exportPdf = async () => {
    if (!pdfRef.current) return;
    setIsExporting(true);

    try {
      const [{ default: html2canvas }, { jsPDF }] = await Promise.all([
        import('html2canvas'),
        import('jspdf'),
      ]);
      const pages = Array.from(pdfRef.current.querySelectorAll('.pdf-page'));
      const pdf = new jsPDF({ orientation: 'portrait', unit: 'mm', format: 'a4', compress: true });

      for (let index = 0; index < pages.length; index += 1) {
        const canvas = await html2canvas(pages[index], {
          scale: 2,
          backgroundColor: '#f7f1e9',
          useCORS: true,
        });
        const image = canvas.toDataURL('image/jpeg', 0.92);
        if (index > 0) pdf.addPage();
        pdf.addImage(image, 'JPEG', 0, 0, 210, 297);
      }

      const safeName = documentData.clientName.toLowerCase().replace(/[^a-z0-9]+/gi, '-').replace(/(^-|-$)/g, '') || 'projeto';
      pdf.save(`projeto-inicial-${safeName}.pdf`);
    } finally {
      setIsExporting(false);
    }
  };

  return (
    <main className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <span className="brand-kicker">D'coratto</span>
          <h1>Editor de Documento</h1>
        </div>

        <section className="panel">
          <div className="panel-title">
            <FileText size={17} />
            <span>Dados do Projeto</span>
          </div>
          <TextField label="Cliente" value={documentData.clientName} onChange={(value) => updateDocument('clientName', value)} />
          <TextField label="Contrato" value={documentData.contractNumber} onChange={(value) => updateDocument('contractNumber', value)} />
          <TextField label="Fabrica / Promob" value={documentData.factory} onChange={(value) => updateDocument('factory', value)} />
          <TextField label="Codigo do projeto" value={documentData.projectCode} onChange={(value) => updateDocument('projectCode', value)} />
          <TextField label="Endereco da obra" value={documentData.address} onChange={(value) => updateDocument('address', value)} />
        </section>

        <section className="panel environment-nav">
          <div className="panel-title">
            <LayoutTemplate size={17} />
            <span>Ambientes</span>
          </div>
          {documentData.environments.map((environment, index) => (
            <button
              className={`env-tab ${selectedId === environment.id ? 'active' : ''}`}
              key={environment.id}
              onClick={() => setSelectedId(environment.id)}
            >
              <span>{String(index + 1).padStart(2, '0')}</span>
              {environment.name}
            </button>
          ))}
          <button className="ghost-button" onClick={addEnvironment}>
            <Plus size={16} />
            Adicionar ambiente
          </button>
        </section>
      </aside>

      <section className="editor-pane">
        {selectedEnvironment && (
          <EnvironmentEditor
            environment={selectedEnvironment}
            onChange={(patch) => updateEnvironment(selectedEnvironment.id, patch)}
            onImage={(file) => handleImage(selectedEnvironment.id, file)}
            onRemove={() => removeEnvironment(selectedEnvironment.id)}
            canRemove={documentData.environments.length > 1}
          />
        )}
      </section>

      <section className="preview-pane">
        <div className="preview-toolbar">
          <div>
            <span className="toolbar-kicker">Preview A4</span>
            <strong>{documentData.environments.length + 1} paginas</strong>
          </div>
          <button className="primary-button" onClick={exportPdf} disabled={isExporting}>
            <Download size={16} />
            {isExporting ? 'Gerando...' : 'Exportar PDF'}
          </button>
        </div>
        <DocumentPreview data={documentData} refTarget={pdfRef} />
      </section>
    </main>
  );
}

function TextField({ label, value, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <input value={value} onChange={(event) => onChange(event.target.value)} />
    </label>
  );
}

function SelectField({ label, value, options, onChange }) {
  return (
    <label className="field">
      <span>{label}</span>
      <select value={value} onChange={(event) => onChange(event.target.value)}>
        <option value="">Selecionar</option>
        {options.map((option) => (
          <option value={option} key={option}>{option}</option>
        ))}
      </select>
    </label>
  );
}

function EnvironmentEditor({ environment, onChange, onImage, onRemove, canRemove }) {
  const toggleColor = (colorName) => {
    const colors = environment.colors.includes(colorName)
      ? environment.colors.filter((color) => color !== colorName)
      : [...environment.colors, colorName];
    onChange({ colors });
  };

  const toggleNote = (note) => {
    const notes = environment.notes.includes(note)
      ? environment.notes.filter((item) => item !== note)
      : [...environment.notes, note];
    onChange({ notes });
  };

  return (
    <div className="editor-card">
      <div className="editor-header">
        <div>
          <span className="toolbar-kicker">Ambiente selecionado</span>
          <h2>{environment.name}</h2>
        </div>
        <button className="icon-button" onClick={onRemove} disabled={!canRemove} title="Remover ambiente">
          <Trash2 size={18} />
        </button>
      </div>

      <div className="form-grid">
        <TextField label="Nome do ambiente" value={environment.name} onChange={(value) => onChange({ name: value })} />
        <TextField label="Subtitulo" value={environment.subtitle} onChange={(value) => onChange({ subtitle: value })} />
        <SelectField label="Tamponamentos" value={environment.tamponamentos} options={OPTION_SETS.tamponamentos} onChange={(value) => onChange({ tamponamentos: value })} />
        <SelectField label="Portas" value={environment.portas} options={OPTION_SETS.portas} onChange={(value) => onChange({ portas: value })} />
        <SelectField label="Puxadores" value={environment.puxadores} options={OPTION_SETS.puxadores} onChange={(value) => onChange({ puxadores: value })} />
      </div>

      <label className="upload-zone">
        <ImagePlus size={20} />
        <span>{environment.image ? 'Trocar imagem do ambiente' : 'Adicionar imagem do ambiente'}</span>
        <input type="file" accept="image/*" onChange={(event) => onImage(event.target.files?.[0])} />
      </label>

      <section className="choice-section">
        <h3>Cores</h3>
        <div className="swatch-grid">
          {COLOR_LIBRARY.map((color) => (
            <button
              className={`swatch-option ${environment.colors.includes(color.name) ? 'selected' : ''}`}
              key={color.name}
              onClick={() => toggleColor(color.name)}
            >
              <span style={{ background: color.hex }} />
              {color.name}
            </button>
          ))}
        </div>
      </section>

      <section className="choice-section">
        <h3>Observacoes padrao</h3>
        <div className="note-grid">
          {OPTION_SETS.observacoes.map((note) => (
            <button className={environment.notes.includes(note) ? 'selected' : ''} key={note} onClick={() => toggleNote(note)}>
              {note}
            </button>
          ))}
        </div>
      </section>

      <label className="field">
        <span>Observacao livre</span>
        <textarea value={environment.freeNote} onChange={(event) => onChange({ freeNote: event.target.value })} rows={5} />
      </label>
    </div>
  );
}

function DocumentPreview({ data, refTarget }) {
  return (
    <div className="preview-scroll">
      <div className="pdf-stack" ref={refTarget}>
        <CoverPage data={data} />
        {data.environments.map((environment, index) => (
          <EnvironmentPage environment={environment} pageNumber={index + 2} key={environment.id} />
        ))}
      </div>
    </div>
  );
}

function CoverPage({ data }) {
  return (
    <article className="pdf-page cover-page">
      <div className="page-border" />
      <header className="cover-top">
        <span>Projeto Inicial</span>
        <strong>D'coratto Sob Medida</strong>
      </header>
      <section className="cover-main">
        <p>Nome Cliente</p>
        <h2>{data.clientName || 'Cliente'}</h2>
        <div className="cover-line" />
        <dl>
          <div><dt>Fabrica</dt><dd>{data.factory || '-'}</dd></div>
          <div><dt>N Contrato</dt><dd>{data.contractNumber || '-'}</dd></div>
          <div><dt>Endereco Obra</dt><dd>{data.address || '-'}</dd></div>
        </dl>
      </section>
      <footer className="page-footer">
        <span>{data.projectCode} - {data.clientName} - {data.contractNumber}</span>
        <span>{data.date}</span>
      </footer>
    </article>
  );
}

function EnvironmentPage({ environment, pageNumber }) {
  const colorObjects = environment.colors
    .map((colorName) => COLOR_LIBRARY.find((color) => color.name === colorName))
    .filter(Boolean);

  return (
    <article className="pdf-page environment-page">
      <div className="page-border" />
      <header className="page-heading">
        <span>{environment.subtitle || 'Projeto Inicial'}</span>
        <strong>{environment.name}</strong>
      </header>
      <section className="hero-image">
        {environment.image ? <img src={environment.image} alt="" /> : <div className="image-placeholder">Imagem do ambiente</div>}
      </section>
      <section className="spec-strip">
        <SpecBlock title="Tamponamentos" value={environment.tamponamentos} />
        <SpecBlock title="Portas" value={environment.portas} />
        <SpecBlock title="Puxadores" value={environment.puxadores} />
      </section>
      <section className="color-row">
        <h3>Cores</h3>
        <div>
          {colorObjects.length ? colorObjects.map((color) => (
            <figure key={color.name}>
              <span style={{ background: color.hex }} />
              <figcaption>{color.name}</figcaption>
            </figure>
          )) : <p>Sem cores selecionadas</p>}
        </div>
      </section>
      <section className="notes-row">
        {[...environment.notes, environment.freeNote].filter(Boolean).map((note) => (
          <p key={note}>{note}</p>
        ))}
      </section>
      <footer className="page-footer">
        <span>D'coratto Sob Medida</span>
        <span>{String(pageNumber).padStart(2, '0')}</span>
      </footer>
    </article>
  );
}

function SpecBlock({ title, value }) {
  return (
    <div>
      <span>{title}</span>
      <strong>{value || '-'}</strong>
    </div>
  );
}

createRoot(document.getElementById('root')).render(<App />);
