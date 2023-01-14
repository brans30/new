import React from 'react'
import ReactDom from 'react-dom'
function Viu({ setdata, ele, mmm }) {
  return ReactDom.createPortal(
    <div className='portal' onClick={mmm}>
      <div className='data'>
        <h2>{ele.title}</h2>
        <img src={ele.images[0]} alt='ff'></img>
        <p>مبرمج بقالي 8 شهور</p>
      </div>
    </div>,
    document.getElementById('cont')
  )
}
export default Viu
